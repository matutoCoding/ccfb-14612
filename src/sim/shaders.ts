// ===== GLSL 着色器（WebGL2 / GLSL ES 3.00）=====

export const DEPOSIT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;          // 单位四边形角点 (-1..1)
layout(location=1) in vec4 iPose;            // x,y,angle,lengthPx
layout(location=2) in vec4 iShape;           // widthPx, mass, component, seed
uniform sampler2D uRelief;
uniform vec2 uTexel;
uniform float uEdgeBias;                     // 浮雕边缘纤维带偏强度
out vec2 vUv;
out float vMass;
out float vComp;
out vec2 vDir;

float hash11(float p){ p=fract(p*0.1031); p*=p+33.33; p*=p+p; return fract(p); }

void main(){
  vec2 center = iPose.xy;
  float angle = iPose.z;
  // 浮雕边缘：取高度场梯度，把纤维朝向往边缘切线方向带偏
  vec2 uv = center * uTexel;
  float hL = texture(uRelief, uv - vec2(uTexel.x,0.0)).r;
  float hR = texture(uRelief, uv + vec2(uTexel.x,0.0)).r;
  float hD = texture(uRelief, uv - vec2(0.0,uTexel.y)).r;
  float hU = texture(uRelief, uv + vec2(0.0,uTexel.y)).r;
  vec2 grad = vec2(hR-hL, hU-hD);
  float gmag = length(grad);
  if(gmag > 1.0){
    vec2 tangent = normalize(vec2(-grad.y, grad.x));
    float w = clamp(uEdgeBias * gmag / 60.0, 0.0, 0.85);
    vec2 oldDir = vec2(cos(angle), sin(angle));
    vec2 nd = normalize(mix(oldDir, tangent, w));
    angle = atan(nd.y, nd.x);
  }
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 local = vec2(aCorner.x * iPose.w * 0.5, aCorner.y * iShape.x * 0.5);
  vec2 pos = center + dir * local.x + perp * local.y;
  gl_Position = vec4(pos * uTexel * 2.0 - 1.0, 0.0, 1.0);
  vUv = aCorner * 0.5 + 0.5;
  vMass = iShape.y;
  vComp = iShape.z;
  vDir = dir; // 单位方向向量，不带质量权重
}`;

export const DEPOSIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vMass;
in float vComp;
in vec2 vDir;
layout(location=0) out vec4 oThick;
void main(){
  // 椭圆纤维截面：边缘羽化
  float d = length(vUv * 2.0 - 1.0);
  float cover = smoothstep(1.0, 0.35, d);
  if(cover <= 0.001) discard;
  // 单纹理四通道打包：
  // r=质量累积, g=覆盖率累积, b=带权 cos(angle), a=带权 sin(angle)
  oThick = vec4(vMass * cover, cover, vDir.x * cover, vDir.y * cover);
}`;

/** 归一化 + 絮聚场 + 浮雕脱水调制，输出最终厚度/取向场 */
export const NORMALIZE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uRawThick;
uniform sampler2D uRelief;
uniform vec2 uTexel;
uniform float uFloc;          // 絮聚程度 0~1
uniform float uReliefAmp;     // 浮雕对沉积的调制幅度
uniform float uTargetBW;      // 目标定量 g/m2
uniform float uRawMean;       // 原始沉积均值
uniform float uSeed;
out vec4 outColor;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash12(i);
  float b = hash12(i+vec2(1,0));
  float c = hash12(i+vec2(0,1));
  float d = hash12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.55;
  mat2 rot = mat2(0.8,0.6,-0.6,0.8);
  for(int k=0;k<4;k++){ v += a*vnoise(p); p = rot*p*2.1; a*=0.55; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 cell = gl_FragCoord.xy;
  float raw = texture(uRawThick, uv).r;
  float cover = texture(uRawThick, uv).g;
  // 取向从厚度纹理 b/a 通道取（带覆盖率权重的 cos/sin 累加）
  vec2 oriVec = texture(uRawThick, uv).ba;
  // 浮雕纹理四通道同值，取 .r（过滤模式由运行时探测决定）
  float relief = texture(uRelief, uv).r;

  // 按覆盖率归一：mass/cover 即单位覆盖的纤维质量，天然消除飞溅空隙
  float density = cover > 0.08 ? raw / max(cover, 0.08) : 0.0;

  // 絮聚场：低频相干噪声，絮团特征尺度约 6mm（uTexel.x=1/gridW，按短边 210mm 标定）
  // 幅度直接由 uFloc 驱动，使配方（浓度/流速/打浆→絮聚）能显著改变匀度与 CV
  float pxPerMm = (1.0 / uTexel.x) / 210.0;   // 每毫米栅格数 = gridW/210
  vec2 np = (cell * pxPerMm) / 6.0 + vec2(uSeed * 0.0173, uSeed * 0.0317);
  float n = fbm(np);                       // 0~1
  float flocAmp = 0.10 + uFloc * 0.55;     // 絮聚 0.2->0.21, 0.6->0.43
  float flocFactor = 1.0 + (n - 0.5) * 2.0 * flocAmp;

  // 浮雕脱水：凸起处脱水快、沉积薄；凹下处滞留、偏厚（限幅避免定量 CV 过大）
  float reliefFactor = 1.0 - clamp(relief * uReliefAmp / 55.0, -0.22, 0.22);

  // 未覆盖栅格用邻域信息补场（先给中性密度，后续 CPU 再做扩散补洞）
  float norm = (cover > 0.08 ? density / max(uRawMean, 1e-6) : 0.85) * flocFactor * reliefFactor;
  float bw = norm * uTargetBW;

  vec2 dir = length(oriVec) > 0.05 ? normalize(oriVec) : vec2(1.0, 0.0);
  float angle = atan(dir.y, dir.x);
  // b 通道输出浮雕高度，g 通道输出取向角（保证回读后纸病/清晰度/取向分析可直接用）
  outColor = vec4(bw, angle, relief, flocFactor);
}`;/** 可视化：定量分布伪彩 / 透射光 / 反射光 */
export const VIZ_FS = `#version 300 es
precision highp float;
uniform sampler2D uField;      // r=定量 g/m2, g=取向角, b=浮雕, a=絮聚
uniform vec2 uTexel;
uniform int uMode;             // 0=定量热力 1=透射 2=反射
uniform float uMeanBW;
uniform float uLightAngle;     // 光源角度（反射用）
uniform float uFlip;           // 翻面 0/1
out vec4 outColor;

vec3 heat(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.10,0.18,0.42);
  vec3 c1 = vec3(0.15,0.55,0.75);
  vec3 c2 = vec3(0.35,0.85,0.55);
  vec3 c3 = vec3(0.95,0.85,0.35);
  vec3 c4 = vec3(0.95,0.35,0.25);
  if(t<0.25) return mix(c0,c1,t/0.25);
  if(t<0.5) return mix(c1,c2,(t-0.25)/0.25);
  if(t<0.75) return mix(c2,c3,(t-0.5)/0.25);
  return mix(c3,c4,(t-0.75)/0.25);
}

void main(){
  vec2 uv = gl_FragCoord.xy * uTexel;
  if(uFlip > 0.5) uv.x = 1.0 - uv.x;
  vec4 f = texture(uField, uv);
  float bw = f.r;
  float relief = f.b;
  if(uMode == 0){
    float t = (bw - uMeanBW*0.72) / (uMeanBW*0.56);
    vec3 col = heat(t);
    // 浮雕等值线轻微叠加
    outColor = vec4(col, 1.0);
    return;
  }
  if(uMode == 1){
    // 透射：Beer-Lambert 衰减，厚度（定量）越大越暗；水印靠厚度差出层次
    float absorb = 0.0115 * bw;
    float tr = exp(-absorb);
    // 纤维微观纹理（确定性高频噪声）
    float micro = 0.92 + 0.08 * sin(gl_FragCoord.x*1.7)*sin(gl_FragCoord.y*1.3);
    float v = clamp(tr * micro, 0.0, 1.0);
    vec3 col = vec3(v*0.96, v, v*1.02);
    outColor = vec4(col, 1.0);
    return;
  }
  // 反射：纸张漫反射为主，厚度差异几乎不可见；仅浮雕高光随光源角度微弱变化
  float base = 0.86;
  float h2 = texture(uField, uv + vec2(cos(uLightAngle),sin(uLightAngle))*uTexel*1.5).b;
  float spec = clamp((h2-relief)*0.004, -0.03, 0.05);
  float grain = 0.97 + 0.03*sin(gl_FragCoord.x*2.3+gl_FragCoord.y*1.1);
  float v = clamp((base + spec)*grain, 0.0, 1.0);
  vec3 col = vec3(v*0.98, v*0.97, v*0.93);
  outColor = vec4(col, 1.0);
}`;

export const FULLSCREEN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos,0.0,1.0); }`;
