import { useState, useRef, useCallback, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

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

  const [logoSize, setLogoSize] = useState(150);
  const [logoOpacity, setLogoOpacity] = useState(100);
  const [logoPos, setLogoPos] = useState("custom");
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
  const ffmpegRef = useRef(null);
  const ffmpegLoadedRef = useRef(false);

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

    // Sample border pixels to estimate background color
    const borderPixels = [];
    for (let i = 0; i < w; i++) {
      // Top row
      const tIdx = i * 4;
      borderPixels.push([data[tIdx], data[tIdx + 1], data[tIdx + 2]]);
      // Bottom row
      const bIdx = ((h - 1) * w + i) * 4;
      borderPixels.push([data[bIdx], data[bIdx + 1], data[bIdx + 2]]);
    }
    for (let j = 1; j < h - 1; j++) {
      // Left col
      const lIdx = (j * w) * 4;
      borderPixels.push([data[lIdx], data[lIdx + 1], data[lIdx + 2]]);
      // Right col
      const rIdx = (j * w + w - 1) * 4;
      borderPixels.push([data[rIdx], data[rIdx + 1], data[rIdx + 2]]);
    }

    // Calculate median background color
    const sortCh = (ch) => borderPixels.map(p => p[ch]).sort((a, b) => a - b);
    const median = (arr) => arr[Math.floor(arr.length / 2)];
    const bgR = median(sortCh(0));
    const bgG = median(sortCh(1));
    const bgB = median(sortCh(2));
    const bgLum = (bgR * 0.299 + bgG * 0.587 + bgB * 0.114);

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      let isWatermark = false;
      let wmIntensity = 0;

      if (type === "light" || (type === "auto" && bgLum < 180)) {
        // Light watermark on darker background: pixels brighter than bg
        const diff = lum - bgLum;
        if (diff > 10) {
          isWatermark = true;
          wmIntensity = Math.min(1, diff / 120);
        }
      }

      if (type === "dark" || (type === "auto" && bgLum >= 180)) {
        // Dark watermark on lighter background: pixels darker than bg
        const diff = bgLum - lum;
        if (diff > 10) {
          isWatermark = true;
          wmIntensity = Math.min(1, diff / 120);
        }
      }

      if (type === "auto" && !isWatermark) {
        // Check both directions for auto
        const diffLight = lum - bgLum;
        const diffDark = bgLum - lum;
        if (diffLight > 15) {
          isWatermark = true;
          wmIntensity = Math.min(1, diffLight / 120);
        } else if (diffDark > 15) {
          isWatermark = true;
          wmIntensity = Math.min(1, diffDark / 120);
        }
      }

      if (isWatermark) {
        const blend = wmIntensity * strength;
        // Blend toward background color
        data[i] = Math.round(r + (bgR - r) * blend);
        data[i + 1] = Math.round(g + (bgG - g) * blend);
        data[i + 2] = Math.round(b + (bgB - b) * blend);
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

    if (logoImgRef.current) {
      const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
      const h = logoSize * aspect;
      ctx.save();
      ctx.globalAlpha = logoOpacity / 100;
      ctx.drawImage(logoImgRef.current, logoXRef.current, logoYRef.current, logoSize, h);
      ctx.restore();
    }

    if (mediaType === "video" && videoRef.current && !videoRef.current.paused) {
      animRef.current = requestAnimationFrame(drawFrame);
    }
  }, [covers, attenuations, logoSize, logoOpacity, mediaType, attenuateWatermark]);

  useEffect(() => {
    if (mediaLoaded) drawFrame();
  }, [covers, attenuations, logoSize, logoOpacity, mediaLoaded, drawFrame]);

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

  // ======= FFMPEG LOADER =======
  const loadFFmpeg = async () => {
    if (ffmpegLoadedRef.current) return ffmpegRef.current;

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    setExportStatus("Carregando conversor (primeira vez ~25MB)...");

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegLoadedRef.current = true;
    return ffmpeg;
  };

  // ======= EXPORT VIDEO =======
  const handleExportVideo = async () => {
    if (!mediaLoaded || mediaType !== "video" || !videoRef.current) return;
    const v = videoRef.current;
    const canvas = canvasRef.current;

    setExporting(true);
    setExportProgress(0);
    setExportStatus("Gravando frames...");
    notify("Processando vídeo... aguarde.");

    v.pause();
    cancelAnimationFrame(animRef.current);
    setPlaying(false);

    try {
      // === STEP 1: Record canvas + audio as WebM ===
      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

      // Try to capture audio
      let audioCtx = null;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(v);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination);
        dest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
      } catch (audioErr) {
        console.warn("Áudio não capturado:", audioErr.message);
      }

      const chunks = [];
      const recorder = new MediaRecorder(combinedStream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm",
        videoBitsPerSecond: 5000000,
        audioBitsPerSecond: 128000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recorderDone = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      recorder.start(100);

      v.currentTime = 0;
      await new Promise((r) => { v.onseeked = r; });
      v.muted = false;
      v.play();

      const renderLoop = () => {
        if (v.ended || v.paused) {
          recorder.stop();
          return;
        }
        const ctx = canvas.getContext("2d");
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

        // Apply attenuations
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

        if (logoImgRef.current) {
          const aspect = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
          const h = logoSize * aspect;
          ctx.save();
          ctx.globalAlpha = logoOpacity / 100;
          ctx.drawImage(logoImgRef.current, logoXRef.current, logoYRef.current, logoSize, h);
          ctx.restore();
        }

        if (v.duration) {
          setExportProgress(Math.round((v.currentTime / v.duration) * 50)); // 0-50% for recording
        }
        requestAnimationFrame(renderLoop);
      };

      renderLoop();

      await new Promise((r) => { v.onended = r; });
      recorder.stop();
      await recorderDone;

      // Restore mute
      v.muted = muted;
      v.currentTime = 0;
      drawFrame();

      // === STEP 2: Convert WebM → MP4 with FFmpeg ===
      setExportStatus("Convertendo para MP4...");
      setExportProgress(55);

      const webmBlob = new Blob(chunks, { type: "video/webm" });

      try {
        const ffmpeg = await loadFFmpeg();

        setExportProgress(60);
        setExportStatus("Convertendo para MP4...");

        // Progress handler
        ffmpeg.on("progress", ({ progress }) => {
          setExportProgress(60 + Math.round(progress * 35)); // 60-95%
        });

        // Write WebM to FFmpeg filesystem
        const webmData = await fetchFile(webmBlob);
        await ffmpeg.writeFile("input.webm", webmData);

        setExportProgress(65);

        // Convert to MP4
        await ffmpeg.exec([
          "-i", "input.webm",
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          "output.mp4"
        ]);

        setExportProgress(95);
        setExportStatus("Preparando download...");

        // Read output
        const mp4Data = await ffmpeg.readFile("output.mp4");
        const mp4Blob = new Blob([mp4Data.buffer], { type: "video/mp4" });
        const url = URL.createObjectURL(mp4Blob);

        const a = document.createElement("a");
        a.download = "ib-media-export.mp4";
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Cleanup FFmpeg files
        await ffmpeg.deleteFile("input.webm");
        await ffmpeg.deleteFile("output.mp4");

        setExporting(false);
        setExportProgress(100);
        setExportStatus("");
        notify("Vídeo MP4 exportado com sucesso!");

      } catch (ffmpegErr) {
        // FFmpeg failed — fallback to WebM download
        console.warn("FFmpeg falhou, exportando WebM:", ffmpegErr);
        setExportStatus("FFmpeg indisponível, baixando como WebM...");

        const url = URL.createObjectURL(webmBlob);
        const a = document.createElement("a");
        a.download = "ib-media-export.webm";
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExporting(false);
        setExportProgress(100);
        setExportStatus("");
        notify("Exportado como WebM (conversão MP4 indisponível neste navegador).", "error");
      }

      // Close audio context if created
      if (audioCtx) {
        try { audioCtx.close(); } catch {}
      }

    } catch (err) {
      setExporting(false);
      setExportStatus("");
      notify("Erro ao exportar vídeo: " + err.message, "error");
      v.muted = muted;
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
    canvas: { maxWidth: "100%", maxHeight: "calc(100vh - 160px)", boxShadow: "0 16px 60px rgba(0,0,0,0.6)", borderRadius: 3, cursor: "crosshair" },
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
          </div>

          <div style={S.panel}>
            <div style={S.pt}>4. Exportar</div>
            <button style={{ ...S.btn, ...S.btnP, marginBottom: 6 }} onClick={handleExportImage}>
              📷 Exportar Frame (PNG)
            </button>
            {mediaType === "video" && (
              <button
                style={{ ...S.btn, ...S.btnP, marginBottom: 6, background: exporting ? "#333" : "linear-gradient(135deg, #22c55e, #16a34a)", cursor: exporting ? "not-allowed" : "pointer" }}
                onClick={handleExportVideo}
                disabled={exporting}
              >
                {exporting ? `⏳ ${exportProgress}%` : "🎬 Exportar Vídeo (MP4)"}
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
              Frame: salva o momento atual como imagem<br />
              Vídeo: grava + converte para MP4 com áudio
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
