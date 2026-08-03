// <liquid-glass src="..."> — WebGL lens that follows the pointer over an image.
(function () {
  const FS = `
precision mediump float;
uniform vec3 iResolution;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
uniform vec2 iCover;

vec2 coverUV(vec2 uv) { return (uv - 0.5) * iCover + 0.5; }

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv = fragCoord / iResolution.xy;
  vec2 mouse = iMouse.xy;
  if (length(mouse) < 1.0) mouse = iResolution.xy / 2.0;
  vec2 m2 = (uv - mouse / iResolution.xy);

  float roundedBox = pow(abs(m2.x * iResolution.x / iResolution.y), 6.0) + pow(abs(m2.y), 6.0);
  float rb1 = clamp((1.0 - roundedBox * 10000.0) * 8.0, 0.0, 1.0);
  float rb2 = clamp((0.95 - roundedBox * 9500.0) * 16.0, 0.0, 1.0)
            - clamp(pow(0.9 - roundedBox * 9500.0, 1.0) * 16.0, 0.0, 1.0);
  float rb3 = clamp((1.5 - roundedBox * 11000.0) * 2.0, 0.0, 1.0)
            - clamp(pow(1.0 - roundedBox * 11000.0, 1.0) * 2.0, 0.0, 1.0);

  gl_FragColor = vec4(0.0);
  float transition = smoothstep(0.0, 1.0, rb1 + rb2);

  if (transition > 0.0) {
    vec2 lens = ((uv - 0.5) * (1.0 - roundedBox * 5000.0) + 0.5);
    float total = 0.0;
    vec4 acc = vec4(0.0);
    for (float x = -4.0; x <= 4.0; x++) {
      for (float y = -4.0; y <= 4.0; y++) {
        vec2 offset = vec2(x, y) * 0.5 / iResolution.xy;
        acc += texture2D(iChannel0, coverUV(offset + lens));
        total += 1.0;
      }
    }
    acc /= total;
    float gradient = clamp((clamp(m2.y, 0.0, 0.2) + 0.1) / 2.0, 0.0, 1.0)
                   + clamp((clamp(-m2.y, -1000.0, 0.2) * rb3 + 0.1) / 2.0, 0.0, 1.0);
    vec4 lighting = clamp(acc + vec4(rb1) * gradient + vec4(rb2) * 0.3, 0.0, 1.0);
    gl_FragColor = mix(texture2D(iChannel0, coverUV(uv)), lighting, transition);
  } else {
    gl_FragColor = texture2D(iChannel0, coverUV(uv));
  }
}`;

  const VS = "attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }";

  class LiquidGlass extends HTMLElement {
    connectedCallback() {
      if (this.canvas) return;
      this.style.display = "block";
      this.style.position = this.style.position || "relative";
      this.canvas = document.createElement("canvas");
      this.canvas.style.cssText = "display:block;width:100%;height:100%;";
      this.appendChild(this.canvas);

      const gl = this.canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
      if (!gl) return;
      this.gl = gl;

      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); return null; }
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, "position");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      this.u = {
        res: gl.getUniformLocation(prog, "iResolution"),
        mouse: gl.getUniformLocation(prog, "iMouse"),
        tex: gl.getUniformLocation(prog, "iChannel0"),
        cover: gl.getUniformLocation(prog, "iCover")
      };

      this.mouse = [0, 0];
      this.imgSize = [1, 1];
      this._move = (e) => {
        const r = this.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.mouse = [(e.clientX - r.left) * dpr, (r.bottom - e.clientY) * dpr];
      };
      window.addEventListener("pointermove", this._move, { passive: true });

      this.texture = gl.createTexture();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.imgSize = [img.naturalWidth, img.naturalHeight];
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.ready = true;
      };
      img.src = this.getAttribute("src") || "";

      this.resize();
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this);
      this.loop();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    loop() {
      this._raf = requestAnimationFrame(() => this.loop());
      const gl = this.gl;
      if (!gl || !this.ready) return;
      const w = this.canvas.width, h = this.canvas.height;
      gl.viewport(0, 0, w, h);
      gl.uniform3f(this.u.res, w, h, 1);
      gl.uniform4f(this.u.mouse, this.mouse[0], this.mouse[1], 0, 0);
      // cover-fit the texture
      const ca = w / h, ia = this.imgSize[0] / this.imgSize[1];
      const sx = ca > ia ? 1 : ia / ca;
      const sy = ca > ia ? ca / ia : 1;
      gl.uniform2f(this.u.cover, sx, sy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.u.tex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener("pointermove", this._move);
      if (this._ro) this._ro.disconnect();
    }
  }

  if (!customElements.get("liquid-glass")) customElements.define("liquid-glass", LiquidGlass);
})();
