// WebGL2 引擎：
// 1) 纤维 instanced quad 加法混合 splat -> 定量纹理(R32F) + 厚度纹理(R32F)，MRT 一次出
// 2) 全屏观察 pass：定量热力 / 透射 / 反射 / 浮雕 / 厚度 / 絮聚
// 加法混合与实例顺序无关，浮点纹理保证同输入逐位一致

import type { PackedFibers } from './types';

const SPLAT_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec4 iSeg;
in float iMass;
in float iWidth;
in float iSpecies;
uniform vec2 uGrid;
out vec2 vLocal;
out float vMass;
out float vSpecies;
void main() {
  vec2 d = iSeg.zw - iSeg.xy;
  float len = length(d);
  vec2 axis = d / max(len, 1e-5);
  vec2 normal = vec2(-axis.y, axis.x);
  vec2 center = (iSeg.xy + iSeg.zw) * 0.5;
  vec2 world = center + axis * (aCorner.x * len * 0.5) + normal * (aCorner.y * iWidth * 0.5);
  // 外扩 0.6px，保证对角线方向的纹素不被四边形边界裁掉
  world += axis * aCorner.x * 0.6 + normal * aCorner.y * 0.6;
  vec2 clip = world / uGrid * 2.0 - 1.0;
  // 不做 y 翻转：FBO 纹理与 readPixels 同为左下原点，坐标系一致性由回读后的单次翻转保证
  gl_Position = vec4(clip, 0.0, 1.0);
  vLocal = aCorner;
  vMass = iMass;
  vSpecies = iSpecies;
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vMass;
in float vSpecies;
uniform float uScale;
uniform float uCaliper;
layout(location = 0) out vec4 outBasis;
layout(location = 1) out vec4 outThick;
void main() {
  // 高斯软覆盖：纤维网络在纹素尺度上搭接，横向高斯 + 端部圆角
  float ax = abs(vLocal.x);
  float ay = abs(vLocal.y);
  float endCap = 1.0 - smoothstep(0.85, 1.0, ax);
  float lateral = exp(-2.2 * ay * ay);
  float cov = endCap * lateral;
  // 不同浆种细微密度差
  float spFactor = 1.0 + (vSpecies - 1.0) * 0.04;
  outBasis = vec4(vMass * cov * uScale * spFactor, 0.0, 0.0, 1.0);
  outThick = vec4(cov * vMass * uScale * uCaliper, 0.0, 0.0, 1.0);
}`;

const VIEW_VS = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const VIEW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uBasis;
uniform sampler2D uThick;
uniform sampler2D uRelief;
uniform sampler2D uFloc;
uniform int uMode; // 0 basis 1 trans 2 reflect 3 relief 4 thick 5 floc
uniform float uMean;
uniform float uStd;
uniform float uMeanThick;
uniform float uEmboss;
uniform float uReliefScale;
uniform float uAngle; // 光源角 rad
uniform float uFlip;  // 翻面
out vec4 frag;

vec3 heatRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.16, 0.27, 0.63);
  vec3 c1 = vec3(0.16, 0.67, 0.78);
  vec3 c2 = vec3(0.35, 0.75, 0.43);
  vec3 c3 = vec3(0.90, 0.78, 0.27);
  vec3 c4 = vec3(0.82, 0.27, 0.20);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // 全屏三角形 vUv 为左下原点，数据纹理为左上原点
  if (uFlip > 0.5) uv.y = 1.0 - uv.y;
  float basis = texture(uBasis, uv).r;
  float thick = texture(uThick, uv).r;
  float relief = texture(uRelief, uv).r;
  float floc = texture(uFloc, uv).r;

  if (uMode == 0) {
    float z = (basis - uMean) / max(uStd, 1e-4);
    frag = vec4(heatRamp(0.5 + z / 5.0), 1.0);
  } else if (uMode == 1) {
    // 透射：归一化厚度 1.0 为均值；基础吸收 0.55 + 厚度波动 + 浮雕压薄增益（relief 归一到 -1~1）
    float thicknessN = thick / max(uMeanThick, 1e-4);
    float reliefN = relief / max(uReliefScale, 1e-4);
    float optical = 0.55 + 0.35 * (thicknessN - 1.0) - uEmboss * reliefN;
    float path = 1.0 / max(cos(uAngle), 0.25);
    float t = exp(-optical * path);
    float bright = clamp(pow(t, 0.9), 0.02, 1.0);
    frag = vec4(bright * vec3(1.0, 0.98, 0.92), 1.0);
  } else if (uMode == 2) {
    // 反射：表面漫反射，厚度差异贡献很弱；水印仅保留极弱的浮雕光影
    vec2 grad = vec2(dFdx(relief), dFdy(relief));
    float shade = dot(grad, vec2(sin(uAngle), cos(uAngle))) * 0.1;
    float thicknessN = thick / max(uMeanThick, 1e-4);
    float base = 0.86 + (thicknessN - 1.0) * 0.03 + shade;
    base += (relief / max(uReliefScale, 1e-4)) * 0.035; // 浮雕可见度仅 3.5%，反射下水印几乎看不出
    frag = vec4(clamp(base, 0.0, 1.0) * vec3(0.97, 0.96, 0.93), 1.0);
  } else if (uMode == 3) {
    float rn = clamp(relief / max(uReliefScale, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
    frag = vec4(vec3(rn), 1.0);
  } else if (uMode == 4) {
    float g = clamp(thick / max(uMeanThick * 2.0, 1e-4), 0.0, 1.0);
    frag = vec4(vec3(g), 1.0);
  } else {
    float z = (floc - 1.0) * 2.2;
    frag = vec4(heatRamp(0.5 + z), 1.0);
  }
}`;

export type ViewMode = 0 | 1 | 2 | 3 | 4 | 5;

export class GlEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private splatProg: WebGLProgram;
  private viewProg: WebGLProgram;
  private vbo: WebGLBuffer | null = null;
  private quadVbo: WebGLBuffer;
  private screenVbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private viewVao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private fiberCount = 0;
  private basisTex: WebGLTexture | null = null;
  private thickTex: WebGLTexture | null = null;
  private gridW = 0;
  private gridH = 0;
  private meanBasis = 0;
  private stdBasis = 0;
  private meanThick = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('缺少 EXT_color_buffer_float 扩展，无法渲染浮点纹理');
    this.splatProg = this.buildProgram(SPLAT_VS, SPLAT_FS);
    this.viewProg = this.buildProgram(VIEW_VS, VIEW_FS);
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // 全屏三角形顶点缓冲（3 个顶点覆盖屏幕），viewVao 必须有启用的属性，部分驱动不支持空 VAO
    this.screenVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    this.viewVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.viewVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
    const posLoc = gl.getAttribLocation(this.viewProg, 'aPos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer()!;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`着色器编译失败: ${log}`);
    }
    return sh;
  }

  private buildProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`程序链接失败: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  private makeFloatTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    // NEAREST：部分驱动（SwiftShader）对 R32F 的 LINEAR 过滤有缺陷会返回 0；定量场逐纹素精确即可
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** 浮雕纹理的归一化幅度（μm），观察着色器用它把 relief 归一到 -1~1 */
  private reliefScale = 1;

  uploadScalar(field: Float32Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = this.makeFloatTexture(w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, field);
    return tex;
  }

  /** 上传浮雕并记录其最大绝对幅度，供观察着色器归一化 */
  uploadRelief(field: Float32Array, w: number, h: number): WebGLTexture {
    let maxAbs = 1;
    for (const v of field) maxAbs = Math.max(maxAbs, Math.abs(v));
    this.reliefScale = maxAbs;
    return this.uploadScalar(field, w, h);
  }

  private deleteTex(tex: WebGLTexture | null): void {
    if (tex) this.gl.deleteTexture(tex);
  }

  private uploadFibers(fibers: PackedFibers): void {
    const gl = this.gl;
    if (!this.vbo) this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, fibers.data, gl.STATIC_DRAW);
    this.fiberCount = fibers.count;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    const cornerLoc = gl.getAttribLocation(this.splatProg, 'aCorner');
    gl.enableVertexAttribArray(cornerLoc);
    gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(cornerLoc, 0); // 逐顶点，显式声明防止继承实例 divisor

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 8 * 4;
    const attrs: [string, number, number][] = [
      ['iSeg', 4, 0],
      ['iMass', 1, 4 * 4],
      ['iWidth', 1, 5 * 4],
      ['iSpecies', 1, 6 * 4],
    ];
    for (const [name, size, offset] of attrs) {
      const loc = gl.getAttribLocation(this.splatProg, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  /**
   * 执行沉积 splat。
   * 归一化：sum(texel)=targetBw*N -> 全幅平均恰好等于目标定量 g/m2
   * （仿真编排层会再做一次按实测均值的归一化，保证换种子零均值偏差）
   */
  runDeposition(relief: Float32Array, floc: Float32Array, fibers: PackedFibers, gw: number, gh: number, targetBw: number, _sheetAreaM2: number, weightSum: number): {
    basisTex: WebGLTexture;
    thickTex: WebGLTexture;
    reliefTex: WebGLTexture;
    flocTex: WebGLTexture;
    basis: Float32Array;
    thickness: Float32Array;
    meanBasis: number;
    stdBasis: number;
  } {
    const gl = this.gl;
    this.gridW = gw;
    this.gridH = gh;
    this.canvas.width = gw;
    this.canvas.height = gh;
    this.deleteTex(this.basisTex);
    this.deleteTex(this.thickTex);
    this.basisTex = this.makeFloatTexture(gw, gh);
    this.thickTex = this.makeFloatTexture(gw, gh);
    const reliefTex = this.uploadRelief(relief, gw, gh);
    const flocTex = this.uploadScalar(floc, gw, gh);
    this.uploadFibers(fibers);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.basisTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.thickTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, gw, gh);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const scale = (targetBw * gw * gh) / weightSum;

    gl.useProgram(this.splatProg);
    gl.uniform2f(gl.getUniformLocation(this.splatProg, 'uGrid'), gw, gh);
    gl.uniform1f(gl.getUniformLocation(this.splatProg, 'uScale'), scale);
    gl.uniform1f(gl.getUniformLocation(this.splatProg, 'uCaliper'), 0.012);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.fiberCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    const basis = new Float32Array(gw * gh);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, gw, gh, gl.RED, gl.FLOAT, basis);
    const thickness = new Float32Array(gw * gh);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, gw, gh, gl.RED, gl.FLOAT, thickness);

    let sum = 0;
    let sumSq = 0;
    for (const v of basis) {
      sum += v;
      sumSq += v * v;
    }
    const n = basis.length;
    this.meanBasis = sum / n;
    this.stdBasis = Math.sqrt(Math.max(0, sumSq / n - this.meanBasis * this.meanBasis));
    let thickSum = 0;
    for (const v of thickness) thickSum += v;
    this.meanThick = thickSum / thickness.length;
    return { basisTex: this.basisTex!, thickTex: this.thickTex!, reliefTex, flocTex, basis, thickness, meanBasis: this.meanBasis, stdBasis: this.stdBasis };
  }

  /** 渲染观察视图到内部 canvas（外部 drawImage 展示） */
  renderView(mode: ViewMode, reliefTex: WebGLTexture, flocTex: WebGLTexture, angleRad: number, flip: boolean, emboss: number): void {
    const gl = this.gl;
    // 显式重置到默认 framebuffer 与干净状态，避免上一次调用残留的绑定影响
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.gridW, this.gridH);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.viewProg);
    gl.bindVertexArray(this.viewVao);
    this.bindTex(0, this.basisTex!, 'uBasis');
    this.bindTex(1, this.thickTex!, 'uThick');
    this.bindTex(2, reliefTex, 'uRelief');
    this.bindTex(3, flocTex, 'uFloc');
    gl.activeTexture(gl.TEXTURE0); // 复位活动纹理单元
    const u = (name: string) => gl.getUniformLocation(this.viewProg, name);
    gl.uniform1i(u('uMode'), mode);
    gl.uniform1f(u('uMean'), this.meanBasis);
    gl.uniform1f(u('uStd'), this.stdBasis);
    gl.uniform1f(u('uMeanThick'), this.meanThick);
    gl.uniform1f(u('uEmboss'), emboss);
    gl.uniform1f(u('uReliefScale'), this.reliefScale);
    gl.uniform1f(u('uAngle'), angleRad);
    gl.uniform1f(u('uFlip'), flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private bindTex(unit: number, tex: WebGLTexture, name: string): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.viewProg, name), unit);
  }

  /** 当前 canvas 内容导出 dataURL（JPEG 缩略图） */
  toDataUrl(mode: ViewMode, reliefTex: WebGLTexture, flocTex: WebGLTexture, angleRad: number, flip: boolean, emboss: number, maxW = 420): string {
    this.renderView(mode, reliefTex, flocTex, angleRad, flip, emboss);
    const out = document.createElement('canvas');
    const sc = maxW / this.gridW;
    out.width = maxW;
    out.height = Math.round(this.gridH * sc);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.82);
  }

  dispose(): void {
    const gl = this.gl;
    this.deleteTex(this.basisTex);
    this.deleteTex(this.thickTex);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.quadVbo);
    gl.deleteBuffer(this.screenVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.viewVao);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.splatProg);
    gl.deleteProgram(this.viewProg);
  }
}
