import { useState, useRef, useCallback, useEffect } from "react";

const POSITIONS = {
  custom: "Posição livre (arraste)",
  "top-left": "Canto sup. esquerdo",
  "top-right": "Canto sup. direito",
  "bottom-left": "Canto inf. esquerdo",
  "bottom-right": "Canto inf. direito",
  center: "Centro",
};

export default function MediaEditor() {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const animRef = useRef(null);
  const sourceImgRef = useRef(null);
  const logoImgRef = useRef(null);

  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaType, setMediaType] = useState(null);
  const [mediaName, setMediaName] = useState("");
  const [logoName, setLogoName] = useState("");
  const [status, setStatus] = useState("Nenhum arquivo");
  const [notification, setNotification] = useState({ msg: "", type: "" });

  const [covers, setCovers] = useState([]);
  const [coverColor, setCoverColor] = useState("#000000");
  const [blur, setBlur] = useState(0);
  const [toolMode, setToolMode] = useState("cover"); // "cover" | "remove"
  const [removeStrength, setRemoveStrength] = useState(70);
  const [removeType, setRemoveType] = useState("light"); // "light" | "dark" | "auto"
  const [attenuations, setAttenuations] = useState([]); // saved attenuation regions

  // Video/image frame border (moldura geral)
  const [frameBorder, setFrameBorder] = useState("none"); // none | white | gray | black | custom
  const [frameBorderWidth, setFrameBorderWidth] = useState(8);
  const [frameBorderColor, setFrameBorderColor] = useState("#ffffff");
  const [frameBorderRadius, setFrameBorderRadius] = useState(0);

  const [logoSize, setLogoSize] = useState(150);
  const [logoOpacity, setLogoOpacity] = useState(100);
  const [logoPos, setLogoPos] = useState("custom");
  const [logoTint, setLogoTint] = useState(""); // hex color to tint logo, empty = no tint
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [logoBorder, setLogoBorder] = useState("none");
  const [logoBorderWidth, setLogoBorderWidth] = useState(4);
  const [logoAnimation, setLogoAnimation] = useState("none");
  const [logoAnimDuration, setLogoAnimDuration] = useState(1.5);
  const logoAnimStartRef = useRef(null);
  const logoXRef = useRef(20);
  const logoYRef = useRef(20);

  const drawingRef = useRef(false);
  const drawStartRef = useRef(null);
  const draggingLogoRef = useRef(false);
  const dragOffRef = useRef({ x: 0, y: 0 });

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoTime, setVideoTime] = useState("0:00 / 0:00");
  const [seekVal, setSeekVal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const videoFileUrlRef = useRef(null);

  // ======= NOTIFY =======
  const notify = useCallback((msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification({ msg: "", type: "" }), 3500);
  }, []);

  // ======= WATERMARK ATTENUATION ALGORITHM =======
  const attenuateWatermark = useCallback((region) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // First redraw the clean source
    if (mediaType === "video" && videoRef.current) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    } else if (sourceImgRef.current) {
      ctx.drawImage(sourceImgRef.current, 0, 0, canvas.width, canvas.height);
    }

    const x = Math.round(region.x);
    const y = Math.round(region.y);
    const w = Math.round(region.w);
    const h = Math.round(region.h);

    if (w < 2 || h < 2) return;

    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;
    const strength = region.strength / 100;
    const type = region.type;

    // Sample border pixels with deeper sampling (3 pixels in from edge)
    const borderPixels = [];
    const sampleDepth = Math.min(5, Math.floor(w / 4), Math.floor(h / 4));
    for (let d = 0; d < sampleDepth; d++) {
      for (let i = 0; i < w; i++) {
        const tIdx = (d * w + i) * 4;
        if (tIdx + 2 < data.length) borderPixels.push([data[tIdx], data[tIdx + 1], data[tIdx + 2]]);
        const bIdx = ((h - 1 - d) * w + i) * 4;
        if (bIdx + 2 < data.length) borderPixels.push([data[bIdx], data[bIdx + 1], data[bIdx + 2]]);
      }
      for (let j = sampleDepth; j < h - sampleDepth; j++) {
        const lIdx = (j * w + d) * 4;
        if (lIdx + 2 < data.length) borderPixels.push([data[lIdx], data[lIdx + 1], data[lIdx + 2]]);
        const rIdx = (j * w + w - 1 - d) * 4;
        if (rIdx + 2 < data.length) borderPixels.push([data[rIdx], data[rIdx + 1], data[rIdx + 2]]);
      }
    }

    // Calculate median background color
    const sortCh = (ch) => borderPixels.map(p => p[ch]).sort((a, b) => a - b);
    const median = (arr) => arr[Math.floor(arr.length / 2)];
    const bgR = median(sortCh(0));
    const bgG = median(sortCh(1));
    const bgB = median(sortCh(2));
    const bgLum = (bgR * 0.299 + bgG * 0.587 + bgB * 0.114);

    // Process each pixel — lower thresholds, stronger curve
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      let wmIntensity = 0;
      const threshold = 3; // very low threshold to catch subtle marks
      const range = 60; // smaller range = more aggressive detection

      if (type === "light" || type === "auto") {
        const diff = lum - bgLum;
        if (diff > threshold) {
          wmIntensity = Math.max(wmIntensity, Math.min(1, (diff - threshold) / range));
        }
      }

      if (type === "dark" || type === "auto") {
        const diff = bgLum - lum;
        if (diff > threshold) {
          wmIntensity = Math.max(wmIntensity, Math.min(1, (diff - threshold) / range));
        }
      }

      if (wmIntensity > 0) {
        // Apply power curve for stronger effect at higher intensities
        const curved = Math.pow(wmIntensity, 0.6);
        const blend = curved * strength;
        // Extra boost: apply multiple blend passes mathematically
        const multiBlend = 1 - Math.pow(1 - blend, 2);
        data[i] = Math.round(r + (bgR - r) * multiBlend);
        data[i + 1] = Math.round(g + (bgG - g) * multiBlend);
        data[i + 2] = Math.round(b + (bgB - b) * multiBlend);
      }
    }

    ctx.putImageData(imageData, x, y);

    // Return the processed ImageData so we can re-apply it in drawFrame
    return imageData;
  }, [mediaType]);

  // ======= DRAW =======
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (mediaType === "video" && videoRef.current) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    } else if (sourceImgRef.current) {
      ctx.drawImage(sourceImgRef.current, 0, 0, canvas.width, canvas.height);
    }

    // Apply saved attenuations
    attenuations.forEach((att) => {
      attenuateWatermark(att);
    });

    covers.forEach((c) => {
      ctx.save();
      ctx.fillStyle = c.color;
      if (c.blur > 0) ctx.filter = `blur(${c.blur}px)`;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.restore();
    });

    // === FRAME BORDER (moldura do vídeo/imagem) ===
    if (frameBorder !== "none" && frameBorderWidth > 0) {
      const fbw = frameBorderWidth;
      const colors = { white: "#ffffff", gray: "#888888", black: "#000000", custom: frameBorderColor };
      ctx.save();
      ctx.strokeStyle = colors[frameBorder] || "#ffffff";
      ctx.lineWidth = fbw * 2; // doubled because half is outside canvas
      if (frameBorderRadius > 0) {
        const r = frameBorderRadius;
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.stroke();
        // Clip corners to radius
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.roundRect(fbw, fbw, canvas.width - fbw*2, canvas.height - fbw*2, Math.max(0, r - fbw));
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.fill("evenodd");
        ctx.globalCompositeOperation = "source-over";
        // Redraw border on top
        ctx.strokeStyle = colors[frameBorder] || "#ffffff";
        ctx.lineWidth = fbw * 2;
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.stroke();
      } else {
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }

    if (logoImgRef.current) {
      const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
      const h = logoSize * aspect;
      const baseX = logoXRef.current;
      const baseY = logoYRef.current;

      // === ANIMATION CALCULATIONS ===
      let animAlpha = 1;
      let animX = 0, animY = 0;
      let animScale = 1;
      let animRotation = 0;

      if (logoAnimation !== "none" && mediaType === "video" && videoRef.current) {
        const currentTime = videoRef.current.currentTime;
        if (logoAnimStartRef.current === null) logoAnimStartRef.current = currentTime;
        const elapsed = currentTime - logoAnimStartRef.current;
        const t = Math.min(1, elapsed / logoAnimDuration); // 0→1 progress
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad

        switch (logoAnimation) {
          case "fadeIn":
            animAlpha = ease;
            break;
          case "slideLeft":
            animX = (1 - ease) * -300;
            break;
          case "slideRight":
            animX = (1 - ease) * 300;
            break;
          case "slideUp":
            animY = (1 - ease) * 200;
            break;
          case "slideDown":
            animY = (1 - ease) * -200;
            break;
          case "zoomIn":
            animScale = 0.1 + ease * 0.9;
            animAlpha = ease;
            break;
          case "spin":
            animRotation = (1 - ease) * Math.PI * 2;
            animScale = 0.5 + ease * 0.5;
            break;
          case "bounce": {
            const bounceEase = t < 0.5
              ? 4 * t * t * t
              : 1 - Math.pow(-2 * t + 2, 3) / 2;
            animY = (1 - bounceEase) * -150;
            animScale = 0.8 + bounceEase * 0.2;
            break;
          }
          case "pulse": {
            animAlpha = ease;
            const pulseT = Math.min(1, elapsed / (logoAnimDuration * 0.5));
            animScale = 1 + Math.sin(pulseT * Math.PI * 3) * 0.15 * (1 - pulseT);
            break;
          }
        }
      }

      ctx.save();
      ctx.globalAlpha = (logoOpacity / 100) * animAlpha;

      // Apply transforms
      const cx = baseX + animX + (logoSize * animScale) / 2;
      const cy = baseY + animY + (h * animScale) / 2;
      ctx.translate(cx, cy);
      if (animRotation !== 0) ctx.rotate(animRotation);
      ctx.scale(animScale, animScale);
      ctx.translate(-logoSize / 2, -h / 2);

      // === BORDER ===
      if (logoBorder !== "none") {
        const bw = logoBorderWidth;
        const borderColors = { white: "#ffffff", gray: "#888888", black: "#000000" };
        ctx.strokeStyle = borderColors[logoBorder] || "#ffffff";
        ctx.lineWidth = bw;
        ctx.lineJoin = "round";
        ctx.strokeRect(-bw / 2, -bw / 2, logoSize + bw, h + bw);
      }

      // === TINTED OR NORMAL LOGO ===
      if (logoTint) {
        const offCanvas = document.createElement("canvas");
        offCanvas.width = logoSize;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext("2d");
        offCtx.drawImage(logoImgRef.current, 0, 0, logoSize, h);
        offCtx.globalCompositeOperation = "source-in";
        offCtx.fillStyle = logoTint;
        offCtx.fillRect(0, 0, logoSize, h);
        ctx.drawImage(offCanvas, 0, 0);
      } else {
        ctx.drawImage(logoImgRef.current, 0, 0, logoSize, h);
      }

      ctx.restore();
    }

    if (mediaType === "video" && videoRef.current && !videoRef.current.paused) {
      animRef.current = requestAnimationFrame(drawFrame);
    }
  }, [covers, attenuations, logoSize, logoOpacity, logoTint, logoBorder, logoBorderWidth, logoAnimation, logoAnimDuration, frameBorder, frameBorderWidth, frameBorderColor, frameBorderRadius, mediaType, attenuateWatermark]);

  useEffect(() => {
    if (mediaLoaded) drawFrame();
  }, [covers, attenuations, logoSize, logoOpacity, logoTint, logoBorder, logoBorderWidth, frameBorder, frameBorderWidth, frameBorderColor, frameBorderRadius, mediaLoaded, drawFrame]);

  // ======= LOAD MEDIA =======
  const handleMediaFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMediaName(file.name);

    const isVideo = file.type.startsWith("video") || /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(file.name);
    const isImage = file.type.startsWith("image") || /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name);

    if (isVideo) {
      // Use createObjectURL — works in normal browsers, NOT in Claude sandbox
      const url = URL.createObjectURL(file);
      videoFileUrlRef.current = url;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      let ready = false;
      const onReady = () => {
        if (ready) return;
        if (video.videoWidth > 0) {
          ready = true;
          videoRef.current = video;
          const canvas = canvasRef.current;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          setMediaType("video");
          setMediaLoaded(true);
          setCovers([]);
          setPlaying(false);
          setStatus("Vídeo OK");
          notify("Vídeo carregado!");
          setTimeout(() => drawFrame(), 50);
        }
      };

      video.onloadeddata = onReady;
      video.oncanplay = onReady;
      video.onloadedmetadata = () => setTimeout(onReady, 200);
      video.onerror = () => notify("Erro ao carregar vídeo. Tente outro formato.", "error");

      video.src = url;
      video.load();
      setTimeout(() => { if (!ready && video.readyState >= 2) onReady(); }, 3000);

    } else if (isImage) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        sourceImgRef.current = img;
        const canvas = canvasRef.current;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        setMediaType("image");
        setMediaLoaded(true);
        setCovers([]);
        setStatus("Imagem OK");
        notify("Imagem carregada!");
        setTimeout(() => drawFrame(), 50);
      };
      img.onerror = () => notify("Erro ao carregar imagem.", "error");
      img.src = url;
    } else {
      notify("Formato não suportado.", "error");
    }
  };

  // ======= LOAD LOGO =======
  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoName(file.name);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      logoImgRef.current = img;
      notify("Logo carregada!");
      if (mediaLoaded) drawFrame();
    };
    img.src = url;
  };

  // ======= CANVAS INTERACTION =======
  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  };

  const getCoordsEnd = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  };

  const isOnLogo = (pos) => {
    if (!logoImgRef.current) return false;
    const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
    const h = logoSize * aspect;
    return pos.x >= logoXRef.current && pos.x <= logoXRef.current + logoSize &&
           pos.y >= logoYRef.current && pos.y <= logoYRef.current + h;
  };

  const onDown = (e) => {
    if (!mediaLoaded) return;
    e.preventDefault();
    const pos = getCoords(e);

    // Eyedropper mode — pick color from canvas
    if (eyedropperActive) {
      const ctx = canvasRef.current.getContext("2d");
      const pixel = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
      const hex = "#" + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, "0")).join("");
      setLogoTint(hex);
      setEyedropperActive(false);
      drawFrame();
      notify("Cor capturada: " + hex);
      return;
    }

    if (logoImgRef.current && isOnLogo(pos)) {
      draggingLogoRef.current = true;
      dragOffRef.current = { x: pos.x - logoXRef.current, y: pos.y - logoYRef.current };
      return;
    }
    drawingRef.current = true;
    drawStartRef.current = pos;
  };

  const onMove = (e) => {
    if (!mediaLoaded) return;
    e.preventDefault();
    let pos;
    try { pos = getCoords(e); } catch { return; }

    if (draggingLogoRef.current) {
      logoXRef.current = pos.x - dragOffRef.current.x;
      logoYRef.current = pos.y - dragOffRef.current.y;
      drawFrame();
      return;
    }

    if (drawingRef.current && drawStartRef.current) {
      drawFrame();
      const ctx = canvasRef.current.getContext("2d");
      const rx = Math.min(drawStartRef.current.x, pos.x);
      const ry = Math.min(drawStartRef.current.y, pos.y);
      const rw = Math.abs(pos.x - drawStartRef.current.x);
      const rh = Math.abs(pos.y - drawStartRef.current.y);

      ctx.save();
      if (toolMode === "cover") {
        ctx.fillStyle = coverColor;
        if (blur > 0) ctx.filter = `blur(${blur}px)`;
        ctx.fillRect(rx, ry, rw, rh);
      } else {
        // Preview for remove mode — dashed border
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = "rgba(245, 158, 11, 0.1)";
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.restore();
    }
  };

  const onUp = (e) => {
    if (draggingLogoRef.current) {
      draggingLogoRef.current = false;
      setLogoPos("custom");
      return;
    }
    if (drawingRef.current && drawStartRef.current) {
      const pos = getCoordsEnd(e);
      const x = Math.min(drawStartRef.current.x, pos.x);
      const y = Math.min(drawStartRef.current.y, pos.y);
      const w = Math.abs(pos.x - drawStartRef.current.x);
      const h = Math.abs(pos.y - drawStartRef.current.y);
      if (w > 5 && h > 5) {
        if (toolMode === "cover") {
          setCovers((prev) => [...prev, { x, y, w, h, color: coverColor, blur }]);
        } else {
          // Remove mode — save attenuation region
          setAttenuations((prev) => [...prev, { x, y, w, h, strength: removeStrength, type: removeType }]);
          notify("Marca d'água atenuada!");
        }
      }
      drawingRef.current = false;
      drawStartRef.current = null;
    }
  };

  // ======= VIDEO CONTROLS =======
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = muted;
      if (logoAnimation !== "none") logoAnimStartRef.current = null; // reset anim on play
      v.play(); setPlaying(true); drawFrame();
    } else {
      v.pause(); cancelAnimationFrame(animRef.current); setPlaying(false); drawFrame();
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const newMuted = !muted;
    setMuted(newMuted);
    v.muted = newMuted;
  };

  const handleSeek = (val) => {
    setSeekVal(val);
    const v = videoRef.current;
    if (v?.duration) { v.currentTime = (val / 100) * v.duration; if (v.paused) drawFrame(); }
  };

  useEffect(() => {
    if (mediaType !== "video" || !videoRef.current) return;
    const v = videoRef.current;
    const update = () => {
      if (!v.duration) return;
      setSeekVal((v.currentTime / v.duration) * 100);
      const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
      setVideoTime(fmt(v.currentTime) + " / " + fmt(v.duration));
    };
    v.addEventListener("timeupdate", update);
    return () => v.removeEventListener("timeupdate", update);
  }, [mediaType, mediaLoaded]);

  // ======= LOGO POSITION =======
  const applyLogoPos = (pos) => {
    setLogoPos(pos);
    if (!logoImgRef.current || !canvasRef.current) return;
    const c = canvasRef.current;
    const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
    const h = logoSize * aspect;
    const m = 20;
    const map = {
      "top-left": [m, m],
      "top-right": [c.width - logoSize - m, m],
      "bottom-left": [m, c.height - h - m],
      "bottom-right": [c.width - logoSize - m, c.height - h - m],
      center: [(c.width - logoSize) / 2, (c.height - h) / 2],
    };
    if (map[pos]) { logoXRef.current = map[pos][0]; logoYRef.current = map[pos][1]; }
    drawFrame();
  };

  // ======= EXPORT IMAGE =======
  const handleExportImage = () => {
    if (!mediaLoaded) return;
    drawFrame();
    try {
      const a = document.createElement("a");
      a.download = "ib-media-export.png";
      a.href = canvasRef.current.toDataURL("image/png");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      notify("Imagem exportada!");
    } catch (err) {
      notify("Erro: " + err.message, "error");
    }
  };

  // ======= EXPORT VIDEO (normal speed + audio) =======
  const handleExportVideo = async () => {
    if (!mediaLoaded || mediaType !== "video" || !videoRef.current) return;
    const v = videoRef.current;
    const canvas = canvasRef.current;

    setExporting(true);
    setExportProgress(0);
    setExportStatus("Preparando gravação...");

    v.pause();
    cancelAnimationFrame(animRef.current);
    setPlaying(false);

    try {
      // Canvas video stream
      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

      // Audio: capture from video element
      let audioCtx = null;
      let hasAudio = false;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(v);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination);
        dest.stream.getAudioTracks().forEach((t) => {
          combinedStream.addTrack(t);
          hasAudio = true;
        });
      } catch (e) {
        console.warn("Audio capture failed:", e.message);
      }

      // Best mime type
      let mimeType = "video/webm";
      let fileExt = "webm";
      for (const [m, e] of [
        ["video/webm;codecs=vp8,opus", "webm"],
        ["video/webm;codecs=vp9,opus", "webm"],
        ["video/webm", "webm"],
      ]) {
        if (MediaRecorder.isTypeSupported(m)) { mimeType = m; fileExt = e; break; }
      }

      const videoDuration = v.duration;
      setExportStatus(`Gravando... (${Math.round(videoDuration)}s de vídeo)`);

      const chunks = [];
      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 4000000,
        audioBitsPerSecond: 128000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recorderDone = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start(200);

      // Seek to start
      v.currentTime = 0;
      logoAnimStartRef.current = null;
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));

      // Play at NORMAL speed with audio
      v.playbackRate = 1;
      v.muted = false;
      v.volume = 1;
      await v.play();

      let exportDone = false;

      // Render loop
      const renderLoop = () => {
        if (exportDone) return;

        // Check if video ended
        if (v.ended || v.currentTime >= videoDuration - 0.05) {
          if (!exportDone) {
            exportDone = true;
            try { recorder.stop(); } catch {}
          }
          return;
        }

        const ctx = canvas.getContext("2d");
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

        // Attenuations
        attenuations.forEach((att) => { attenuateWatermark(att); });

        // Covers
        covers.forEach((c) => {
          ctx.save();
          ctx.fillStyle = c.color;
          if (c.blur > 0) ctx.filter = `blur(${c.blur}px)`;
          ctx.fillRect(c.x, c.y, c.w, c.h);
          ctx.restore();
        });

        // Logo with animation
        if (logoImgRef.current) {
          const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
          const lh = logoSize * aspect;
          const bx = logoXRef.current, by = logoYRef.current;
          let aA = 1, aX = 0, aY = 0, aS = 1, aR = 0;
          if (logoAnimation !== "none") {
            const ct = v.currentTime;
            if (logoAnimStartRef.current === null) logoAnimStartRef.current = ct;
            const el = ct - logoAnimStartRef.current;
            const t = Math.min(1, el / logoAnimDuration);
            const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
            switch (logoAnimation) {
              case "fadeIn": aA = ease; break;
              case "slideLeft": aX = (1-ease)*-300; break;
              case "slideRight": aX = (1-ease)*300; break;
              case "slideUp": aY = (1-ease)*200; break;
              case "slideDown": aY = (1-ease)*-200; break;
              case "zoomIn": aS = 0.1+ease*0.9; aA = ease; break;
              case "spin": aR = (1-ease)*Math.PI*2; aS = 0.5+ease*0.5; break;
              case "bounce": { const be = t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; aY=(1-be)*-150; aS=0.8+be*0.2; break; }
              case "pulse": { aA=ease; const pt=Math.min(1,el/(logoAnimDuration*0.5)); aS=1+Math.sin(pt*Math.PI*3)*0.15*(1-pt); break; }
            }
          }
          ctx.save();
          ctx.globalAlpha = (logoOpacity/100)*aA;
          ctx.translate(bx+aX+(logoSize*aS)/2, by+aY+(lh*aS)/2);
          if (aR !== 0) ctx.rotate(aR);
          ctx.scale(aS, aS);
          ctx.translate(-logoSize/2, -lh/2);
          if (logoBorder !== "none") {
            const bw = logoBorderWidth;
            ctx.strokeStyle = {white:"#fff",gray:"#888",black:"#000"}[logoBorder]||"#fff";
            ctx.lineWidth = bw; ctx.lineJoin = "round";
            ctx.strokeRect(-bw/2,-bw/2,logoSize+bw,lh+bw);
          }
          if (logoTint) {
            const oc = document.createElement("canvas"); oc.width=logoSize; oc.height=lh;
            const ox = oc.getContext("2d"); ox.drawImage(logoImgRef.current,0,0,logoSize,lh);
            ox.globalCompositeOperation="source-in"; ox.fillStyle=logoTint; ox.fillRect(0,0,logoSize,lh);
            ctx.drawImage(oc,0,0);
          } else { ctx.drawImage(logoImgRef.current,0,0,logoSize,lh); }
          ctx.restore();
        }

        // Frame border
        if (frameBorder !== "none" && frameBorderWidth > 0) {
          const fbC = { white:"#fff", gray:"#888", black:"#000", custom: frameBorderColor };
          ctx.save();
          ctx.strokeStyle = fbC[frameBorder] || "#fff";
          ctx.lineWidth = frameBorderWidth * 2;
          if (frameBorderRadius > 0) {
            ctx.beginPath(); ctx.roundRect(0,0,canvas.width,canvas.height,frameBorderRadius); ctx.stroke();
          } else { ctx.strokeRect(0,0,canvas.width,canvas.height); }
          ctx.restore();
        }

        // Progress
        if (videoDuration > 0) {
          const pct = Math.round((v.currentTime / videoDuration) * 100);
          setExportProgress(pct);
          const remaining = Math.round(videoDuration - v.currentTime);
          setExportStatus(`Gravando... ${remaining}s restantes`);
        }

        requestAnimationFrame(renderLoop);
      };

      renderLoop();

      // Wait for end: use both event listener AND polling (bulletproof)
      await new Promise((resolve) => {
        // Listener
        v.addEventListener("ended", () => {
          if (!exportDone) { exportDone = true; try { recorder.stop(); } catch {} }
          resolve();
        }, { once: true });

        // Polling every 500ms as safety net
        const poll = setInterval(() => {
          if (exportDone || v.ended || v.currentTime >= videoDuration - 0.05) {
            clearInterval(poll);
            if (!exportDone) { exportDone = true; try { recorder.stop(); } catch {} }
            resolve();
          }
        }, 500);

        // Ultimate timeout: videoDuration + 5 seconds
        setTimeout(() => {
          clearInterval(poll);
          if (!exportDone) { exportDone = true; try { v.pause(); recorder.stop(); } catch {} }
          resolve();
        }, (videoDuration + 5) * 1000);
      });

      await recorderDone;

      // Restore
      v.muted = muted;
      v.currentTime = 0;
      v.playbackRate = 1;
      drawFrame();
      if (audioCtx) try { audioCtx.close(); } catch {}

      // Download
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      if (blob.size < 1000) {
        throw new Error("Vídeo gerado vazio. Tente novamente.");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = `ib-media-export.${fileExt}`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setExporting(false);
      setExportProgress(100);
      setExportStatus("");
      notify(`Vídeo exportado! (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);

    } catch (err) {
      setExporting(false);
      setExportStatus("");
      if (videoRef.current) {
        videoRef.current.playbackRate = 1;
        videoRef.current.muted = muted;
      }
      notify("Erro: " + err.message, "error");
    }
  };

  // ======= UNDO =======
  useEffect(() => {
    const h = (e) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        if (toolMode === "remove") {
          setAttenuations((p) => p.slice(0, -1));
        } else {
          setCovers((p) => p.slice(0, -1));
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toolMode]);

  // ======= STYLES =======
  const S = {
    app: { display: "flex", flexDirection: "column", height: "100vh", background: "#0b0b12", color: "#e4e4ee", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", height: 52, background: "#111118", borderBottom: "1px solid #252535", flexShrink: 0 },
    brand: { display: "flex", alignItems: "center", gap: 10 },
    mark: { width: 30, height: 30, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "#fff", letterSpacing: -1 },
    h1: { fontSize: 15, fontWeight: 600 },
    dim: { color: "#6b6b88", fontWeight: 300 },
    badge: (ok) => ({ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: "#1a1a28", border: `1px solid ${ok ? "#22c55e" : "#252535"}`, color: ok ? "#22c55e" : "#6b6b88", fontFamily: "monospace", letterSpacing: "0.03em" }),
    main: { display: "flex", flex: 1, overflow: "hidden" },
    sidebar: { width: 270, background: "#111118", borderRight: "1px solid #252535", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 },
    panel: { background: "#181822", border: "1px solid #252535", borderRadius: 10, padding: 14 },
    pt: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b6b88", marginBottom: 10, fontWeight: 600 },
    fileLabel: (active) => ({ display: "block", width: "100%", padding: "16px 10px", border: `2px dashed ${active ? "#22c55e" : "#252535"}`, borderStyle: active ? "solid" : "dashed", borderRadius: 8, background: "transparent", color: active ? "#22c55e" : "#6b6b88", cursor: "pointer", textAlign: "center", fontSize: 12, transition: "all 0.2s" }),
    btn: { width: "100%", padding: "9px 14px", borderRadius: 8, border: "1px solid #252535", background: "#181822", color: "#e4e4ee", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
    btnP: { background: "linear-gradient(135deg, #6366f1, #7c3aed)", border: "none", color: "#fff" },
    btnD: { borderColor: "#ef4444", color: "#ef4444", background: "transparent" },
    area: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0b0b12", position: "relative", overflow: "hidden", padding: 20 },
    dots: { position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)", backgroundSize: "30px 30px", pointerEvents: "none" },
    canvas: { maxWidth: "100%", maxHeight: "calc(100vh - 160px)", boxShadow: "0 16px 60px rgba(0,0,0,0.6)", borderRadius: 3, cursor: eyedropperActive ? "crosshair" : "crosshair" },
    empty: { textAlign: "center", color: "#6b6b88", zIndex: 1 },
    emptyIcon: { width: 68, height: 68, margin: "0 auto 16px", background: "#111118", border: "1px solid #252535", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center" },
    lbl: { fontSize: 11, color: "#6b6b88", display: "flex", justifyContent: "space-between", marginBottom: 4 },
    mono: { fontFamily: "monospace", color: "#e4e4ee", fontSize: 11 },
    slider: { width: "100%", accentColor: "#6366f1", marginBottom: 8 },
    sel: { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #252535", background: "#0b0b12", color: "#e4e4ee", fontSize: 11, marginTop: 4 },
    notif: (type) => ({ position: "fixed", top: 14, right: 14, padding: "10px 18px", background: "#111118", border: `1px solid ${type === "error" ? "#ef4444" : "#22c55e"}`, borderRadius: 8, color: type === "error" ? "#ef4444" : "#22c55e", fontSize: 12, zIndex: 200, boxShadow: "0 8px 30px rgba(0,0,0,0.4)", animation: "slideIn 0.3s ease" }),
    vc: { display: "flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 520, marginTop: 10, zIndex: 1 },
    play: { width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #7c3aed)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 },
    help: { fontSize: 9, color: "#6b6b88", marginTop: 6, textAlign: "center", lineHeight: 1.4 },
  };

  return (
    <div style={S.app}>
      <style>{`@keyframes slideIn { from { transform: translateX(80px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={S.brand}>
          <div style={S.mark}>IB</div>
          <span style={S.h1}>Media Editor <span style={S.dim}>— Marca d'Água</span></span>
        </div>
        <span style={S.badge(mediaLoaded)}>{status}</span>
      </div>

      {notification.msg && <div style={S.notif(notification.type)}>{notification.msg}</div>}

      <div style={S.main}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          <div style={S.panel}>
            <div style={S.pt}>1. Carregar Mídia</div>
            <label style={S.fileLabel(!!mediaName)}>
              <input type="file" accept="video/*,image/*" onChange={handleMediaFile} style={{ display: "none" }} />
              {mediaName ? <><strong>{mediaName}</strong><br /><span style={{ fontSize: 10 }}>Clique para trocar</span></> : <><strong style={{ color: "#6366f1" }}>Selecionar arquivo</strong><br />Vídeo ou imagem</>}
            </label>
          </div>

          <div style={S.panel}>
            <div style={S.pt}>2. Remover Marca d'Água</div>

            {/* Tool mode tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              <button
                style={{ ...S.btn, flex: 1, padding: "7px 8px", fontSize: 11, ...(toolMode === "remove" ? { background: "linear-gradient(135deg, #f59e0b, #d97706)", border: "none", color: "#fff" } : {}) }}
                onClick={() => setToolMode("remove")}
              >
                ✨ Atenuar
              </button>
              <button
                style={{ ...S.btn, flex: 1, padding: "7px 8px", fontSize: 11, ...(toolMode === "cover" ? S.btnP : {}) }}
                onClick={() => setToolMode("cover")}
              >
                ■ Cobrir
              </button>
            </div>

            {toolMode === "remove" ? (
              <>
                <p style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8 }}>
                  Desenhe sobre a marca d'água. O algoritmo detecta e atenua os pixels da marca.
                </p>
                <div style={S.lbl}><span>Tipo de marca</span></div>
                <select value={removeType} onChange={(e) => setRemoveType(e.target.value)} style={{ ...S.sel, marginTop: 0, marginBottom: 8 }}>
                  <option value="auto">Auto-detectar</option>
                  <option value="light">Clara (branca/cinza)</option>
                  <option value="dark">Escura (preta/cinza)</option>
                </select>
                <div style={S.lbl}><span>Intensidade</span><span style={S.mono}>{removeStrength}%</span></div>
                <input type="range" min={20} max={100} value={removeStrength} onChange={(e) => setRemoveStrength(+e.target.value)} style={S.slider} />
                <button style={{ ...S.btn, borderColor: "#f59e0b", color: "#f59e0b", background: "transparent" }} onClick={() => { setAttenuations([]); drawFrame(); }}>
                  Limpar atenuações
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8 }}>
                  Desenhe retângulos para cobrir a marca d'água.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#6b6b88", flex: 1 }}>Cor</span>
                  <input type="color" value={coverColor} onChange={(e) => setCoverColor(e.target.value)} style={{ width: 30, height: 30, border: "2px solid #252535", borderRadius: 6, cursor: "pointer", background: "none" }} />
                </div>
                <div style={S.lbl}><span>Desfoque</span><span style={S.mono}>{blur}px</span></div>
                <input type="range" min={0} max={30} value={blur} onChange={(e) => setBlur(+e.target.value)} style={S.slider} />
                <button style={{ ...S.btn, ...S.btnD }} onClick={() => setCovers([])}>Limpar coberturas</button>
              </>
            )}
          </div>

          <div style={S.panel}>
            <div style={S.pt}>3. Inserir Logo</div>
            <label style={S.fileLabel(!!logoName)}>
              <input type="file" accept="image/*" onChange={handleLogoFile} style={{ display: "none" }} />
              {logoName ? <><strong>{logoName}</strong><br /><span style={{ fontSize: 10 }}>Clique para trocar</span></> : <><strong style={{ color: "#6366f1" }}>Selecionar logo</strong><br />PNG transparente recomendado</>}
            </label>
            <div style={{ height: 8 }} />
            <div style={S.lbl}><span>Tamanho</span><span style={S.mono}>{logoSize}px</span></div>
            <input type="range" min={30} max={500} value={logoSize} onChange={(e) => setLogoSize(+e.target.value)} style={S.slider} />
            <div style={S.lbl}><span>Opacidade</span><span style={S.mono}>{logoOpacity}%</span></div>
            <input type="range" min={10} max={100} value={logoOpacity} onChange={(e) => setLogoOpacity(+e.target.value)} style={S.slider} />
            <select value={logoPos} onChange={(e) => applyLogoPos(e.target.value)} style={S.sel}>
              {Object.entries(POSITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            {/* Tint / Eyedropper */}
            <div style={{ marginTop: 8, padding: "10px", background: "#111118", borderRadius: 8, border: "1px solid #252535" }}>
              <div style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Cor da Logo</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button
                  style={{
                    ...S.btn,
                    flex: 1,
                    padding: "7px 6px",
                    fontSize: 11,
                    background: eyedropperActive ? "linear-gradient(135deg, #f59e0b, #d97706)" : "#181822",
                    border: eyedropperActive ? "none" : "1px solid #252535",
                    color: eyedropperActive ? "#fff" : "#e4e4ee",
                  }}
                  onClick={() => setEyedropperActive(!eyedropperActive)}
                >
                  💧 {eyedropperActive ? "Clique no vídeo..." : "Conta-gotas"}
                </button>
                <input
                  type="color"
                  value={logoTint || "#ffffff"}
                  onChange={(e) => { setLogoTint(e.target.value); drawFrame(); }}
                  style={{ width: 36, height: 36, border: "2px solid #252535", borderRadius: 6, cursor: "pointer", background: "none", flexShrink: 0 }}
                />
              </div>
              {logoTint && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: logoTint, border: "1px solid #333", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "#e4e4ee", flex: 1 }}>{logoTint}</span>
                  <button
                    style={{ fontSize: 10, background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "2px 6px" }}
                    onClick={() => { setLogoTint(""); drawFrame(); }}
                  >
                    ✕ Reset
                  </button>
                </div>
              )}
              {!logoTint && (
                <p style={{ fontSize: 9, color: "#6b6b88", lineHeight: 1.3 }}>
                  Use o conta-gotas para capturar uma cor do vídeo e aplicar na logo, ou escolha manualmente.
                </p>
              )}
            </div>

            {/* Border */}
            <div style={{ marginTop: 8, padding: "10px", background: "#111118", borderRadius: 8, border: "1px solid #252535" }}>
              <div style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Borda da Logo</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                {[
                  { val: "none", label: "Sem", bg: "transparent" },
                  { val: "white", label: "Branca", bg: "#ffffff" },
                  { val: "gray", label: "Cinza", bg: "#888888" },
                  { val: "black", label: "Preta", bg: "#000000" },
                ].map((b) => (
                  <button
                    key={b.val}
                    onClick={() => setLogoBorder(b.val)}
                    style={{
                      flex: 1, padding: "6px 4px", fontSize: 10, borderRadius: 6, cursor: "pointer",
                      background: logoBorder === b.val ? "#252535" : "transparent",
                      border: logoBorder === b.val ? "1px solid #6366f1" : "1px solid #252535",
                      color: "#e4e4ee",
                    }}
                  >
                    {b.val !== "none" && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: b.bg, border: "1px solid #444", marginRight: 3, verticalAlign: "middle" }} />}
                    {b.label}
                  </button>
                ))}
              </div>
              {logoBorder !== "none" && (
                <>
                  <div style={S.lbl}><span>Espessura</span><span style={S.mono}>{logoBorderWidth}px</span></div>
                  <input type="range" min={1} max={15} value={logoBorderWidth} onChange={(e) => setLogoBorderWidth(+e.target.value)} style={S.slider} />
                </>
              )}
            </div>

            {/* Animation (video only) */}
            {mediaType === "video" && (
              <div style={{ marginTop: 8, padding: "10px", background: "#111118", borderRadius: 8, border: "1px solid #252535" }}>
                <div style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Animação da Logo</div>
                <select value={logoAnimation} onChange={(e) => { setLogoAnimation(e.target.value); logoAnimStartRef.current = null; }} style={{ ...S.sel, marginTop: 0 }}>
                  <option value="none">Sem animação</option>
                  <option value="fadeIn">Fade In (aparecer)</option>
                  <option value="slideLeft">Deslizar da esquerda</option>
                  <option value="slideRight">Deslizar da direita</option>
                  <option value="slideUp">Subir de baixo</option>
                  <option value="slideDown">Descer de cima</option>
                  <option value="zoomIn">Zoom In</option>
                  <option value="spin">Girar + Zoom</option>
                  <option value="bounce">Quicar</option>
                  <option value="pulse">Pulsar</option>
                </select>
                {logoAnimation !== "none" && (
                  <>
                    <div style={S.lbl}><span>Duração</span><span style={S.mono}>{logoAnimDuration}s</span></div>
                    <input type="range" min={0.3} max={5} step={0.1} value={logoAnimDuration} onChange={(e) => setLogoAnimDuration(+e.target.value)} style={S.slider} />
                    <button
                      style={{ ...S.btn, padding: "6px 10px", fontSize: 11 }}
                      onClick={() => {
                        const v = videoRef.current;
                        if (v) { v.currentTime = 0; logoAnimStartRef.current = null; v.play(); setPlaying(true); drawFrame(); }
                      }}
                    >
                      ▶ Preview animação
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Frame border / Moldura */}
          <div style={S.panel}>
            <div style={S.pt}>4. Moldura do Vídeo</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
              {[
                { val: "none", label: "Sem" },
                { val: "white", label: "Branca" },
                { val: "gray", label: "Cinza" },
                { val: "black", label: "Preta" },
                { val: "custom", label: "Cor..." },
              ].map((b) => (
                <button
                  key={b.val}
                  onClick={() => setFrameBorder(b.val)}
                  style={{
                    flex: 1, minWidth: 48, padding: "6px 4px", fontSize: 10, borderRadius: 6, cursor: "pointer",
                    background: frameBorder === b.val ? "#252535" : "transparent",
                    border: frameBorder === b.val ? "1px solid #6366f1" : "1px solid #252535",
                    color: "#e4e4ee",
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {frameBorder === "custom" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#6b6b88", flex: 1 }}>Cor</span>
                <input type="color" value={frameBorderColor} onChange={(e) => setFrameBorderColor(e.target.value)} style={{ width: 30, height: 30, border: "2px solid #252535", borderRadius: 6, cursor: "pointer", background: "none" }} />
              </div>
            )}
            {frameBorder !== "none" && (
              <>
                <div style={S.lbl}><span>Espessura</span><span style={S.mono}>{frameBorderWidth}px</span></div>
                <input type="range" min={2} max={40} value={frameBorderWidth} onChange={(e) => setFrameBorderWidth(+e.target.value)} style={S.slider} />
                <div style={S.lbl}><span>Arredondamento</span><span style={S.mono}>{frameBorderRadius}px</span></div>
                <input type="range" min={0} max={60} value={frameBorderRadius} onChange={(e) => setFrameBorderRadius(+e.target.value)} style={S.slider} />
              </>
            )}
          </div>

          <div style={S.panel}>
            <div style={S.pt}>5. Exportar</div>
            <button style={{ ...S.btn, ...S.btnP, marginBottom: 6 }} onClick={handleExportImage}>
              📷 Exportar Frame (PNG)
            </button>
            {mediaType === "video" && (
              <button
                style={{ ...S.btn, marginBottom: 6, background: exporting ? "#333" : "linear-gradient(135deg, #22c55e, #16a34a)", border: "none", color: "#fff", cursor: exporting ? "not-allowed" : "pointer" }}
                onClick={handleExportVideo}
                disabled={exporting}
              >
                {exporting ? `⏳ ${exportProgress}%` : "🎬 Exportar Vídeo com Áudio"}
              </button>
            )}
            {exporting && (
              <>
                <div style={{ width: "100%", height: 6, background: "#252535", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ width: `${exportProgress}%`, height: "100%", background: "linear-gradient(90deg, #6366f1, #22c55e)", borderRadius: 3, transition: "width 0.3s" }} />
                </div>
                {exportStatus && (
                  <p style={{ fontSize: 10, color: "#6b6b88", textAlign: "center", marginBottom: 4 }}>{exportStatus}</p>
                )}
              </>
            )}
            <p style={S.help}>
              Frame: salva o momento atual como PNG<br />
              Vídeo: grava em tempo real com áudio (WebM)
            </p>
          </div>
        </div>

        {/* Canvas area */}
        <div style={S.area}>
          <div style={S.dots} />

          {!mediaLoaded && (
            <div style={S.empty}>
              <div style={S.emptyIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6b6b88" strokeWidth="1.5">
                  <rect x="2" y="2" width="20" height="20" rx="3" />
                  <circle cx="8" cy="8" r="2" />
                  <path d="M22 15l-5-5L5 22" />
                </svg>
              </div>
              <h3 style={{ fontSize: 17, color: "#e4e4ee", marginBottom: 6 }}>Carregue uma mídia</h3>
              <p style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.5 }}>Selecione um vídeo ou imagem na barra lateral para começar a editar.</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            style={{ ...S.canvas, display: mediaLoaded ? "block" : "none" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
          />

          {mediaType === "video" && mediaLoaded && (
            <div style={S.vc}>
              <button style={S.play} onClick={togglePlay}>{playing ? "⏸" : "▶"}</button>
              <button
                style={{ ...S.play, width: 30, height: 30, background: muted ? "#333" : "linear-gradient(135deg, #6366f1, #7c3aed)", fontSize: 12 }}
                onClick={toggleMute}
                title={muted ? "Ativar som" : "Mutar"}
              >
                {muted ? "🔇" : "🔊"}
              </button>
              <input type="range" min={0} max={100} step={0.1} value={seekVal} onChange={(e) => handleSeek(+e.target.value)} style={{ ...S.slider, flex: 1 }} />
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#6b6b88", minWidth: 72, textAlign: "center" }}>{videoTime}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
