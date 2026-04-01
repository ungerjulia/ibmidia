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
  const [videoTime, setVideoTime] = useState("0:00 / 0:00");
  const [seekVal, setSeekVal] = useState(0);

  // ======= NOTIFY =======
  const notify = useCallback((msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification({ msg: "", type: "" }), 3500);
  }, []);

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
  }, [covers, logoSize, logoOpacity, mediaType]);

  useEffect(() => {
    if (mediaLoaded) drawFrame();
  }, [covers, logoSize, logoOpacity, mediaLoaded, drawFrame]);

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
      ctx.save();
      ctx.fillStyle = coverColor;
      if (blur > 0) ctx.filter = `blur(${blur}px)`;
      ctx.fillRect(
        Math.min(drawStartRef.current.x, pos.x),
        Math.min(drawStartRef.current.y, pos.y),
        Math.abs(pos.x - drawStartRef.current.x),
        Math.abs(pos.y - drawStartRef.current.y)
      );
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
        setCovers((prev) => [...prev, { x, y, w, h, color: coverColor, blur }]);
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
      v.play(); setPlaying(true); drawFrame();
    } else {
      v.pause(); cancelAnimationFrame(animRef.current); setPlaying(false); drawFrame();
    }
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

  // ======= EXPORT =======
  const handleExport = () => {
    if (!mediaLoaded) return;
    drawFrame();
    try {
      const a = document.createElement("a");
      a.download = "ib-media-export.png";
      a.href = canvasRef.current.toDataURL("image/png");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      notify("Exportado com sucesso!");
    } catch (err) {
      notify("Erro: " + err.message, "error");
    }
  };

  // ======= UNDO =======
  useEffect(() => {
    const h = (e) => { if (e.key === "z" && (e.ctrlKey || e.metaKey)) setCovers((p) => p.slice(0, -1)); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

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
            <div style={S.pt}>2. Cobrir Marca d'Água</div>
            <p style={{ fontSize: 10, color: "#6b6b88", marginBottom: 8 }}>Desenhe retângulos sobre a marca d'água para cobri-la.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#6b6b88", flex: 1 }}>Cor</span>
              <input type="color" value={coverColor} onChange={(e) => setCoverColor(e.target.value)} style={{ width: 30, height: 30, border: "2px solid #252535", borderRadius: 6, cursor: "pointer", background: "none" }} />
            </div>
            <div style={S.lbl}><span>Desfoque</span><span style={S.mono}>{blur}px</span></div>
            <input type="range" min={0} max={30} value={blur} onChange={(e) => setBlur(+e.target.value)} style={S.slider} />
            <button style={{ ...S.btn, ...S.btnD }} onClick={() => setCovers([])}>Limpar coberturas</button>
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
            <button style={{ ...S.btn, ...S.btnP }} onClick={handleExport}>↓ Exportar Imagem</button>
            <p style={S.help}>Vídeo: exporta o frame atual como PNG<br />Foto: exporta com todas as edições</p>
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
              <input type="range" min={0} max={100} step={0.1} value={seekVal} onChange={(e) => handleSeek(+e.target.value)} style={{ ...S.slider, flex: 1 }} />
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#6b6b88", minWidth: 72, textAlign: "center" }}>{videoTime}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
