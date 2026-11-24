// ===== WebGL2 GPU 沉积引擎 =====
import { DEPOSIT_FS, DEPOSIT_VS, FULLSCREEN_VS, NORMALIZE_FS, VIZ_FS } from './shaders';
import { Rng, mix32 } from './rng';
import type { PulpRecipe, SimParams } from '../types';
import { flocculationLevel, generateFiberPopulation } from './pulp';

function glErr(gl: WebGL2RenderingContext, where: string): void {
  const e = gl.getError();
  if (e !== gl.NO_ERROR) throw new Error(`WebGL错误 @${where}: 0x${e.toString(16)}`);
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/** 浮点纹理（R32F / RGBA32F），要求 EXT_color_buffer_float；过滤模式按运行时探测选择 */
function makeTexture(gl: WebGL2RenderingContext, w: number, h: number, internal: number, filter?: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = filter ?? gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, gl.FLOAT, null);
  return t;
}

export interface GpuFieldOutput {
  thickness: Float32Array; // rg: 定量 g/m², 取向角; b: 浮雕; a: 絮聚因子
  gridW: number;
  gridH: number;
  meanBW: number;
  stdBW: number;
}

export class GpuDepositEngine {
  gl: WebGL2RenderingContext;
  private progDeposit: WebGLProgram;
  private progNorm: WebGLProgram;
  private progViz: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private vaoQuad: WebGLVertexArrayObject;
  private floatColorExt: object | null;
  readonly supportFloat: boolean;
  /** 浮点纹理 LINEAR 过滤是否真正可用（部分 SwiftShader 声明支持但采样返回 0，需运行时探测） */
  readonly floatLinearWorks: boolean;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.floatColorExt = gl.getExtension('EXT_color_buffer_float');
    this.supportFloat = !!this.floatColorExt;
    if (!this.supportFloat) throw new Error('缺少 EXT_color_buffer_float，无法进行浮点纹理计算');
    // 运行时探测浮点纹理 LINEAR 过滤是否真正可采样（软件渲染可能声明支持却返回 0）
    this.floatLinearWorks = this.probeFloatLinear(gl);
    this.progDeposit = program(gl, DEPOSIT_VS, DEPOSIT_FS);
    this.progNorm = program(gl, FULLSCREEN_VS, NORMALIZE_FS);
    this.progViz = program(gl, FULLSCREEN_VS, VIZ_FS);

    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // 关键：VAO 必须在 quadBuf 绑定到 ARRAY_BUFFER 期间创建并配置，
    // 否则 VAO 记录的顶点缓冲绑定为空，全屏 pass 不会执行片元着色器
    this.vaoQuad = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** 探测浮点纹理 LINEAR 过滤采样是否返回正确值 */
  private probeFloatLinear(gl: WebGL2RenderingContext): boolean {
    if (!gl.getExtension('OES_texture_float_linear')) return false;
    try {
      const S = 4;
      const src = new Float32Array(S * S * 4);
      for (let i = 0; i < S * S; i++) src[i * 4] = 37.5;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, S, S, 0, gl.RGBA, gl.FLOAT, src);

      const out = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, out);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, S, S, 0, gl.RGBA, gl.FLOAT, null);

      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(
        vs,
        `#version 300 es
        layout(location=0) in vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }`,
      );
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(
        fs,
        `#version 300 es
        precision highp float;
        uniform sampler2D uT; out vec4 o;
        void main(){ o = vec4(texture(uT, vec2(0.5)).r, 0.0, 0.0, 1.0); }`,
      );
      gl.compileShader(fs);
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        gl.deleteTexture(tex);
        gl.deleteTexture(out);
        return false;
      }
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
      const vbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, S, S);
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(p, 'uT'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Float32Array(4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);

      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      gl.deleteTexture(out);
      gl.deleteProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 采样值应≈37.5；若返回 0 说明 LINEAR 浮点过滤在该实现上失效
      return Math.abs(px[0] - 37.5) < 1;
    } catch {
      return false;
    }
  }

  /** 浮点纹理安全过滤模式 */
  private filterMode(): number {
    return this.floatLinearWorks ? this.gl.LINEAR : this.gl.NEAREST;
  }

  private makeFbo(w: number, h: number, textures: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO 不完整: 0x' + status.toString(16));
    return fbo;
  }

  /**
   * 主沉积流程。
   * @param relief 浮雕高度场 μm（与 gridW/H 同尺寸）
   * @param onProgress 进度回调
   */
  run(
    params: SimParams,
    recipe: PulpRecipe,
    relief: Float32Array,
    onProgress?: (pct: number, stage: string) => void,
  ): GpuFieldOutput {
    const gl = this.gl;
    const t0 = performance.now();
    const { gridW, gridH } = this.computeGrid(params);
    const rng = new Rng(params.seed);

    // —— 1. 浮雕纹理（RGBA32F 四通道，兼容软件渲染对 R32F 采样的差异）——
    onProgress?.(0.02, '上传浮雕场');
    const reliefTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, reliefTex);
    // 过滤模式按运行时探测选择（SwiftShader 浮点 LINEAR 可能失效，回退 NEAREST）
    const safeFilter = this.filterMode();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, safeFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, safeFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const reliefRgba = new Float32Array(gridW * gridH * 4);
    for (let i = 0; i < relief.length; i++) {
      reliefRgba[i * 4] = relief[i];
      reliefRgba[i * 4 + 1] = relief[i];
      reliefRgba[i * 4 + 2] = relief[i];
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gridW, gridH, 0, gl.RGBA, gl.FLOAT, reliefRgba);

    // —— 2. 纤维群体（CPU 确定性生成）——
    onProgress?.(0.08, '生成纤维群体');
    const fibers = generateFiberPopulation(recipe, params.fiberCount, mix32(params.seed ^ 0xf1be5));
    const pxPerMm = gridW / params.widthMm;
    // 实例属性缓冲
    const poseData = new Float32Array(params.fiberCount * 4);
    const shapeData = new Float32Array(params.fiberCount * 4);
    // CPU 取向累加器（与 GPU 同一份确定性 pose；规避软件渲染对浮点纹理 b/a 加性混合的缺陷）
    const oriCos = new Float32Array(gridW * gridH);
    const oriSin = new Float32Array(gridW * gridH);
    const oriW = new Float32Array(gridW * gridH);
    const floc = flocculationLevel(recipe);
    const flowAngle = 0; // 顺流方向 = +x（纵向 MD）
    const kappa = 0.6 + (1 - params.orientationRandomness) * 7.5;

    for (let i = 0; i < params.fiberCount; i++) {
      const f = fibers[i];
      const fr = new Rng(mix32(params.seed ^ Math.imul(i + 1, 0x9e3779b1)));
      const x = fr.next() * gridW;
      const y = fr.next() * gridH;
      const angle = fr.wrappedAngle(flowAngle, kappa);
      const lenPx = Math.max(1.5, f.lengthMm * pxPerMm);
      // 飞溅宽度放大 3.2 倍：保证栅格充分覆盖（真实纤维在 0.75mm 栅格下也是多根重叠）
      const widthPx = Math.max(2.2, (f.widthUm / 1000) * pxPerMm * 3.2);
      // 单根质量代理：粗度×长度（与真实 mg 量纲成比例）
      const mass = f.coarseness * f.lengthMm;
      poseData.set([x, y, angle, lenPx], i * 4);
      shapeData.set([widthPx, mass, f.component, fr.nextU32() / 4294967296], i * 4);

      // CPU 取向：按纤维覆盖的栅格累加 cos/sin（确定性，与 GPU 输入一致）
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const rx = Math.max(1, Math.ceil(lenPx * 0.5));
      const ry = Math.max(1, Math.ceil(widthPx * 0.5));
      const x0 = Math.max(0, Math.floor(x - rx));
      const x1 = Math.min(gridW - 1, Math.ceil(x + rx));
      const y0 = Math.max(0, Math.floor(y - ry));
      const y1 = Math.min(gridH - 1, Math.ceil(y + ry));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const dx = gx - x;
          const dy = gy - y;
          // 椭圆覆盖权重，与片元 smoothstep 近似
          const ex = dx / (lenPx * 0.5);
          const ey = dy / (widthPx * 0.5);
          const dd = ex * ex + ey * ey;
          if (dd > 1) continue;
          const wgt = dd < 0.12 ? 1 : 1 - (dd - 0.12) / 0.88;
          const gi = gy * gridW + gx;
          oriCos[gi] += ca * wgt;
          oriSin[gi] += sa * wgt;
          oriW[gi] += wgt;
        }
      }
    }

    // —— 3. 沉积（单附件四通道打包：质量/覆盖率/cos/sin）——
    onProgress?.(0.2, 'GPU 纤维沉积');
    const rawThickTex = makeTexture(gl, gridW, gridH, gl.RGBA32F);
    const fbo = this.makeFbo(gridW, gridH, [rawThickTex]);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progDeposit);
    gl.uniform2f(gl.getUniformLocation(this.progDeposit, 'uTexel'), 1 / gridW, 1 / gridH);
    gl.uniform1f(gl.getUniformLocation(this.progDeposit, 'uEdgeBias'), 0.8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, reliefTex);
    gl.uniform1i(gl.getUniformLocation(this.progDeposit, 'uRelief'), 0);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    // 单位四边形
    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // 实例缓冲
    const poseBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, poseBuf);
    gl.bufferData(gl.ARRAY_BUFFER, poseData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    const shapeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shapeData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    // 分批绘制（避免单次实例数超驱动限制，每批 6 万）
    const BATCH = 60000;
    const batches = Math.ceil(params.fiberCount / BATCH);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE); // 加性累加
    for (let b = 0; b < batches; b++) {
      const first = b * BATCH;
      const n = Math.min(BATCH, params.fiberCount - first);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, first * 16);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, first * 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      onProgress?.(0.2 + 0.45 * ((b + 1) / batches), 'GPU 纤维沉积');
    }
    glErr(gl, 'deposit');

    // —— 4. 回读原始沉积，求均值 ——
    onProgress?.(0.68, '归一化与絮聚调制');
    const raw = new Float32Array(gridW * gridH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, raw);
    let sum = 0;
    for (let i = 0; i < gridW * gridH; i++) sum += raw[i * 4];
    const rawMean = sum / (gridW * gridH);

    // —— 5. 归一化 + 絮聚 + 浮雕脱水 ——
    const fieldTex = makeTexture(gl, gridW, gridH, gl.RGBA32F);
    const fbo2 = this.makeFbo(gridW, gridH, [fieldTex]);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, gridW, gridH);
    gl.useProgram(this.progNorm);
    gl.bindVertexArray(this.vaoQuad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawThickTex);
    gl.uniform1i(gl.getUniformLocation(this.progNorm, 'uRawThick'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, reliefTex);
    gl.uniform1i(gl.getUniformLocation(this.progNorm, 'uRelief'), 1);
    gl.uniform2f(gl.getUniformLocation(this.progNorm, 'uTexel'), 1 / gridW, 1 / gridH);
    gl.uniform1f(gl.getUniformLocation(this.progNorm, 'uFloc'), floc);
    gl.uniform1f(gl.getUniformLocation(this.progNorm, 'uReliefAmp'), 1.0);
    gl.uniform1f(gl.getUniformLocation(this.progNorm, 'uTargetBW'), recipe.targetBasisWeight);
    gl.uniform1f(gl.getUniformLocation(this.progNorm, 'uRawMean'), rawMean);
    gl.uniform1f(gl.getUniformLocation(this.progNorm, 'uSeed'), (params.seed % 100000) + 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    glErr(gl, 'normalize');

    // —— 6. 回读最终场 ——
    onProgress?.(0.85, '结果回读');
    const field: Float32Array = new Float32Array(gridW * gridH * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, field);

    // 空洞填充：飞溅未覆盖格（近似零值）用邻域扩散补场，固定 8 轮、确定性
    const filled = fillHoles(field, gridW, gridH, recipe.targetBasisWeight, 8);

    // 严格二次归一：只校正 r 通道（定量），保留 g(取向)/b(浮雕)/a(絮聚) 原值
    let mean = 0;
    for (let i = 0; i < gridW * gridH; i++) mean += filled[i * 4];
    mean /= gridW * gridH;
    const corr = recipe.targetBasisWeight / mean;
    let sq = 0;
    for (let i = 0; i < gridW * gridH; i++) {
      let bw = filled[i * 4] * corr;
      // 物理限幅：单格定量不超过目标 2.2 倍、不低于 0.35 倍（抑制飞溅离群点）
      bw = Math.min(recipe.targetBasisWeight * 2.2, Math.max(recipe.targetBasisWeight * 0.35, bw));
      filled[i * 4] = bw;
      const d = bw - recipe.targetBasisWeight;
      sq += d * d;
    }
    const std = Math.sqrt(sq / (gridW * gridH));

    // 用 CPU 确定性取向场覆盖 g 通道（角度 -π~π；无纤维格给顺流 0）
    for (let i = 0; i < gridW * gridH; i++) {
      filled[i * 4 + 1] = oriW[i] > 1e-6 ? Math.atan2(oriSin[i], oriCos[i]) : 0;
    }

    // 把最终校正后的场回传纹理，供可视化直接采样
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, filled);

    // 资源清理
    gl.deleteFramebuffer(fbo);
    gl.deleteFramebuffer(fbo2);
    gl.deleteTexture(rawThickTex);
    gl.deleteBuffer(poseBuf);
    gl.deleteBuffer(shapeBuf);
    gl.deleteBuffer(cornerBuf);
    gl.deleteVertexArray(vao);
    onProgress?.(0.98, `完成，耗时 ${Math.round(performance.now() - t0)}ms`);

    return { thickness: filled, gridW, gridH, meanBW: recipe.targetBasisWeight, stdBW: std };
  }

  computeGrid(params: SimParams): { gridW: number; gridH: number } {
    const shortMm = Math.min(params.widthMm, params.heightMm);
    const longMm = Math.max(params.widthMm, params.heightMm);
    const h = params.gridSize;
    const w = Math.round((h * longMm) / shortMm);
    return { gridW: Math.max(64, w), gridH: h };
  }

  /** 用最终场渲染可视化图到指定 canvas（mode: 0 定量 1 透射 2 反射） */
  renderField(
    fieldTex: WebGLTexture,
    gridW: number,
    gridH: number,
    mode: number,
    meanBW: number,
    lightAngle: number,
    flip: boolean,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progViz);
    gl.bindVertexArray(this.vaoQuad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(gl.getUniformLocation(this.progViz, 'uField'), 0);
    gl.uniform2f(gl.getUniformLocation(this.progViz, 'uTexel'), 1 / gridW, 1 / gridH);
    gl.uniform1i(gl.getUniformLocation(this.progViz, 'uMode'), mode);
    gl.uniform1f(gl.getUniformLocation(this.progViz, 'uMeanBW'), meanBW);
    gl.uniform1f(gl.getUniformLocation(this.progViz, 'uLightAngle'), lightAngle);
    gl.uniform1f(gl.getUniformLocation(this.progViz, 'uFlip'), flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  createFieldTexture(field: Float32Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    return makeTexture(gl, w, h, gl.RGBA32F);
  }

  uploadField(field: Float32Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = this.filterMode();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, field);
    return t;
  }
}

/**
 * 空洞填充（确定性，无随机数）：
 * 仅处理真正零覆盖（r≈0）的飞溅空隙，用 4 邻域有效格均值扩散；
 * 只写 r 通道（定量），g(取向角)/b(浮雕)/a(絮聚) 一律保持 GPU 原值。
 * 注意：浮雕区的低定量是真实物理状态，绝不能当空洞覆盖。
 */
function fillHoles(src: Float32Array, w: number, h: number, targetBW: number, passes: number): Float32Array {
  const field = src.slice();
  const n = w * h;
  // 零覆盖判定：定量接近 0（小于目标的 2%）。正常薄区也远高于此阈值。
  const HOLE = targetBW * 0.02;
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) valid[i] = field[i * 4] > HOLE ? 1 : 0;
  let remaining = valid.reduce((s, v) => s + (v ? 0 : 1), 0);
  if (remaining === 0) return field;

  const work = new Float32Array(n);
  for (let i = 0; i < n; i++) work[i] = valid[i] ? field[i * 4] : 0;

  for (let p = 0; p < passes && remaining > 0; p++) {
    const next = work.slice();
    const nextValid = valid.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (valid[i]) continue;
        let sum = 0;
        let cnt = 0;
        if (x > 0 && valid[i - 1]) { sum += work[i - 1]; cnt++; }
        if (x < w - 1 && valid[i + 1]) { sum += work[i + 1]; cnt++; }
        if (y > 0 && valid[i - w]) { sum += work[i - w]; cnt++; }
        if (y < h - 1 && valid[i + w]) { sum += work[i + w]; cnt++; }
        if (cnt >= 2) {
          next[i] = sum / cnt;
          nextValid[i] = 1;
          remaining--;
        }
      }
    }
    work.set(next);
    valid.set(nextValid);
  }
  // 只回填 r 通道；g/b/a 保持 GPU 输出，未覆盖格的取向沿用着色器给的顺流默认值
  for (let i = 0; i < n; i++) {
    if (!valid[i]) field[i * 4] = work[i] > 0 ? work[i] : targetBW;
  }
  return field;
}
