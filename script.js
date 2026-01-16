const state = {
  width: 800,
  height: 600,
  zoom: 1.0,
  layers: [],
  activeLayerId: null,
  nextLayerId: 1,
  tool: 'move',
  brush: {
    size: 20,
    color: '#ffffff'
  },
  text: {
    content: 'Hello World',
    size: 40,
    color: '#ffffff'
  },
  isDrawing: false, // General purpose flag for mousedown to mouseup
  lastPos: {
    x: 0,
    y: 0
  },
  moveStart: {
    x: 0,
    y: 0,
    layerX: 0,
    layerY: 0
  },
  crop: {
    active: false, // Is crop tool selected
    rect: null, // {x, y, w, h} - current crop rectangle
    isDragging: false, // True if drawing initial selection or resizing
    activeHandle: null, // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w' or null
    aspectRatio: 'free', // 'free' | 'square' | '4:3' | '16:9'
    initialMouseX: 0, // Mouse X at start of drag/resize
    initialMouseY: 0, // Mouse Y at start of drag/resize
    initialRect: null // {x, y, w, h} - Rect at start of drag/resize
  }
};

const stage = document.getElementById('canvas-stage');
const wrapper = document.getElementById('canvas-wrapper');
const cropOverlay = document.getElementById('crop-overlay');
const cropCtx = cropOverlay.getContext('2d');
const layersList = document.getElementById('layers-list');
const cropDimensionsSpan = document.getElementById('crop-dimensions');
const cropRatioButtons = document.querySelectorAll('.crop-ratio-btn');
const HANDLE_SIZE = 8; // Size of crop resize handles in canvas pixels
const tools = ['move', 'brush', 'eraser', 'text', 'crop'];

function init(w = 800, h = 600) {
  setCanvasSize(w, h);
  state.layers = [];
  state.nextLayerId = 1;
  const overlay = document.getElementById('crop-overlay');
  stage.innerHTML = ''; // Clear existing layers except overlay
  stage.appendChild(overlay);
  addLayer("Background");
  const bg = state.layers[0];
  bg.ctx.fillStyle = "white";
  bg.ctx.fillRect(0, 0, state.width, state.height);
  setZoom(1.0);
  updateUI();
  exitCropMode(); // Reset crop state
}

function setCanvasSize(w, h) {
  state.width = w;
  state.height = h;
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  cropOverlay.width = w;
  cropOverlay.height = h;
}
window.addEventListener('paste', (e) => {
  const items = e.clipboardData.items;
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          addLayer("Pasted Image", img);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(blob);
    }
  }
});

function setZoom(lvl) {
  state.zoom = Math.max(0.1, Math.min(5.0, lvl));
  document.getElementById('zoom-val').innerText = Math.round(state.zoom * 100) + '%';
  stage.style.transform = `scale(${state.zoom})`;
  updateWrapperScroll();
}

function updateWrapperScroll() {
  const currentW = state.width * state.zoom;
  const currentH = state.height * state.zoom;
  const availW = wrapper.clientWidth;
  const availH = wrapper.clientHeight;
  stage.style.marginLeft = currentW < availW ? ((availW - currentW) / 2) + 'px' : '0px';
  stage.style.marginTop = currentH < availH ? ((availH - currentH) / 2) + 'px' : '0px';
}
window.onresize = updateWrapperScroll;

function fitToScreen() {
  const pad = 40;
  const wRatio = (wrapper.clientWidth - pad) / state.width;
  const hRatio = (wrapper.clientHeight - pad) / state.height;
  const newZoom = Math.min(wRatio, hRatio, 1.0);
  setZoom(newZoom);
  wrapper.scrollLeft = 0;
  wrapper.scrollTop = 0;
}

function addLayer(name, sourceImage = null) {
  const id = state.nextLayerId++;
  const canvas = document.createElement('canvas');
  canvas.width = state.width;
  canvas.height = state.height;
  canvas.id = `layer-${id}`;
  const ctx = canvas.getContext('2d');
  if (sourceImage) {
    ctx.drawImage(sourceImage, 0, 0);
  }
  const layer = {
    id,
    name: name || `Layer ${state.layers.length + 1}`,
    canvas,
    ctx,
    visible: true,
    opacity: 1.0,
    x: 0,
    y: 0
  };
  state.layers.push(layer);
  stage.insertBefore(canvas, cropOverlay);
  setActiveLayer(id);
  return layer;
}

function setActiveLayer(id) {
  state.activeLayerId = id;
  updateLayersUI();
}

function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId);
}

function deleteLayer() {
  if (state.layers.length <= 1) return alert("Cannot delete the last layer");
  const idx = state.layers.findIndex(l => l.id === state.activeLayerId);
  const layer = state.layers[idx];
  layer.canvas.remove();
  state.layers.splice(idx, 1);
  setActiveLayer(state.layers[Math.max(0, idx - 1)].id);
}

function moveLayerOrder(dir) {
  const idx = state.layers.findIndex(l => l.id === state.activeLayerId);
  if (dir === 1 && idx < state.layers.length - 1) {
    [state.layers[idx], state.layers[idx + 1]] = [state.layers[idx + 1], state.layers[idx]];
  } else if (dir === -1 && idx > 0) {
    [state.layers[idx], state.layers[idx - 1]] = [state.layers[idx - 1], state.layers[idx]];
  }
  refreshLayerZIndex();
  updateLayersUI();
}

function refreshLayerZIndex() {
  state.layers.forEach((l, idx) => {
    l.canvas.style.zIndex = idx;
  });
}

function getMousePos(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / state.zoom,
    y: (e.clientY - rect.top) / state.zoom
  };
}

stage.addEventListener('mousedown', e => {
  if (state.tool === 'crop') return handleCropStart(e);
  const layer = getActiveLayer();
  if (!layer || !layer.visible) return;
  const pos = getMousePos(e);
  if (state.tool === 'text') {
    placeText(pos, layer.ctx, layer);
    return;
  }
  state.isDrawing = true;
  state.lastPos = pos;
  if (state.tool === 'brush' || state.tool === 'eraser') {
    draw(pos);
  } else if (state.tool === 'move') {
    state.moveStart = {
      x: e.clientX,
      y: e.clientY,
      layerX: layer.x,
      layerY: layer.y
    };
  }
});
window.addEventListener('mousemove', e => {
  if (state.tool === 'crop') return handleCropMove(e);
  if (!state.isDrawing) return;
  const layer = getActiveLayer();
  if (!layer) return;
  if (state.tool === 'move') {
    const dx = (e.clientX - state.moveStart.x) / state.zoom;
    const dy = (e.clientY - state.moveStart.y) / state.zoom;
    layer.x = state.moveStart.layerX + dx;
    layer.y = state.moveStart.layerY + dy;
    layer.canvas.style.transform = `translate(${layer.x}px, ${layer.y}px)`;
  } else {
    const pos = getMousePos(e);
    draw(pos);
    state.lastPos = pos;
  }
});
window.addEventListener('mouseup', () => {
  state.isDrawing = false; // General drawing/dragging ended
  if (state.tool === 'crop') handleCropEnd();
});

// Cursor changes for crop tool
cropOverlay.addEventListener('mousemove', setCropCursor);
cropOverlay.addEventListener('mouseleave', () => {
  if (state.tool === 'crop' && !state.crop.isDragging) {
    cropOverlay.style.cursor = 'crosshair';
  }
});

wrapper.addEventListener('wheel', e => {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(state.zoom + delta);
  }
});

function draw(pos) {
  const layer = getActiveLayer();
  const ctx = layer.ctx;
  const lx = pos.x - layer.x;
  const ly = pos.y - layer.y;
  const lastLx = state.lastPos.x - layer.x;
  const lastLy = state.lastPos.y - layer.y;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = state.brush.size;
  if (state.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = state.brush.color;
  }
  ctx.beginPath();
  ctx.moveTo(lastLx, lastLy);
  ctx.lineTo(lx, ly);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function placeText(pos, ctx, layer) {
  if (!state.text.content) return;
  const x = pos.x - layer.x;
  const y = pos.y - layer.y;
  ctx.font = `bold ${state.text.size}px sans-serif`;
  ctx.fillStyle = state.text.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(state.text.content, x, y);
}

function handleCropStart(e) {
  if (!e.target.closest('#canvas-stage')) return; // Ensure click is on stage
  const pos = getMousePos(e);

  if (state.crop.rect) {
    // Check if clicking a handle
    const handle = getHandleAtPoint(pos);
    if (handle) {
      state.crop.isDragging = true;
      state.crop.isResizing = true;
      state.crop.activeHandle = handle;
      state.crop.initialMouseX = pos.x;
      state.crop.initialMouseY = pos.y;
      state.crop.initialRect = {
        ...state.crop.rect
      }; // Deep copy
      return;
    }
    // If clicking inside existing rect but not a handle, start new selection
    if (pos.x >= state.crop.rect.x && pos.x <= state.crop.rect.x + state.crop.rect.w &&
      pos.y >= state.crop.rect.y && pos.y <= state.crop.rect.y + state.crop.rect.h) {
      // For now, if clicking inside existing rect but not handle, assume new selection
      // Could add 'move' functionality for the whole rect here later
    }
  }

  // If no rect, or clicking outside existing rect/handles, start new selection
  state.crop.isDragging = true;
  state.crop.isResizing = false;
  state.crop.activeHandle = null;
  state.crop.start = pos; // Old property, can be merged into initialMouse
  state.crop.initialMouseX = pos.x;
  state.crop.initialMouseY = pos.y;
  state.crop.rect = {
    x: pos.x,
    y: pos.y,
    w: 0,
    h: 0
  }; // Reset rect for new selection
}

function handleCropMove(e) {
  if (!state.crop.isDragging) return;
  const pos = getMousePos(e);

  if (state.crop.isResizing) {
    resizeCropRect(pos);
  } else {
    updateCropRect(pos);
  }
  drawCropOverlay();
  updateCropDimensionsUI();
}

function handleCropEnd() {
  state.crop.isDragging = false;
  state.crop.isResizing = false;
  state.crop.activeHandle = null;
  if (state.crop.rect && (state.crop.rect.w < 1 || state.crop.rect.h < 1)) {
    state.crop.rect = null; // Clear if selection is too small
  }
  drawCropOverlay(); // Clear handles
  updateCropDimensionsUI();
}

function updateCropRect(currentPos) {
  const {
    initialMouseX,
    initialMouseY,
    aspectRatio
  } = state.crop;

  let x1 = initialMouseX;
  let y1 = initialMouseY;
  let x2 = currentPos.x;
  let y2 = currentPos.y;

  let w = x2 - x1;
  let h = y2 - y1;

  if (aspectRatio !== 'free') {
    let ratioW, ratioH;
    switch (aspectRatio) {
      case 'square':
        ratioW = 1;
        ratioH = 1;
        break;
      case '4:3':
        ratioW = 4;
        ratioH = 3;
        break;
      case '16:9':
        ratioW = 16;
        ratioH = 9;
        break;
      default:
        return;
    }
    const targetRatio = ratioW / ratioH;

    // Apply aspect ratio, prioritizing the dimension with larger absolute change
    if (Math.abs(w) > Math.abs(h * targetRatio)) {
      h = w / targetRatio;
    } else {
      w = h * targetRatio;
    }
  }

  let finalX = Math.min(x1, x1 + w);
  let finalY = Math.min(y1, y1 + h);
  let finalW = Math.abs(w);
  let finalH = Math.abs(h);

  state.crop.rect = {
    x: finalX,
    y: finalY,
    w: Math.max(1, finalW),
    h: Math.max(1, finalH)
  };
}

function resizeCropRect(currentPos) {
  const {
    initialRect,
    initialMouseX,
    initialMouseY,
    activeHandle,
    aspectRatio
  } = state.crop;
  if (!initialRect || !activeHandle) return;

  let {
    x,
    y,
    w,
    h
  } = initialRect;
  let newX = x,
    newY = y,
    newW = w,
    newH = h;

  // Determine fixed point (opposite corner to active handle)
  let fixedX, fixedY;
  if (activeHandle.includes('e')) fixedX = x;
  else if (activeHandle.includes('w')) fixedX = x + w;
  else fixedX = x; // For N/S handles, X is not fixed

  if (activeHandle.includes('s')) fixedY = y;
  else if (activeHandle.includes('n')) fixedY = y + h;
  else fixedY = y; // For E/W handles, Y is not fixed

  let deltaX = currentPos.x - initialMouseX;
  let deltaY = currentPos.y - initialMouseY;

  // Calculate new width/height based on handle
  switch (activeHandle) {
    case 'nw':
      newX = x + deltaX;
      newY = y + deltaY;
      newW = w - deltaX;
      newH = h - deltaY;
      break;
    case 'n':
      newY = y + deltaY;
      newH = h - deltaY;
      break;
    case 'ne':
      newY = y + deltaY;
      newW = w + deltaX;
      newH = h - deltaY;
      break;
    case 'e':
      newW = w + deltaX;
      break;
    case 'se':
      newW = w + deltaX;
      newH = h + deltaY;
      break;
    case 's':
      newH = h + deltaY;
      break;
    case 'sw':
      newX = x + deltaX;
      newW = w - deltaX;
      newH = h + deltaY;
      break;
    case 'w':
      newX = x + deltaX;
      newW = w - deltaX;
      break;
  }

  // Ensure positive width/height
  if (newW < 0) {
    newX += newW;
    newW = -newW;
  }
  if (newH < 0) {
    newY += newH;
    newH = -newH;
  }

  // Apply aspect ratio
  if (aspectRatio !== 'free') {
    let ratioW, ratioH;
    switch (aspectRatio) {
      case 'square':
        ratioW = 1;
        ratioH = 1;
        break;
      case '4:3':
        ratioW = 4;
        ratioH = 3;
        break;
      case '16:9':
        ratioW = 16;
        ratioH = 9;
        break;
      default:
        return;
    }
    const targetRatio = ratioW / ratioH;

    // Recalculate based on fixed point and mouse position for accurate ratio
    let currentXFromFixed, currentYFromFixed;

    // Adjust currentPos based on initial mouse position relative to fixed point
    const mouseXRatio = (currentPos.x - initialMouseX);
    const mouseYRatio = (currentPos.y - initialMouseY);

    let newAspectW = initialRect.w;
    let newAspectH = initialRect.h;

    switch (activeHandle) {
      case 'nw':
        newAspectW = initialRect.w - mouseXRatio;
        newAspectH = initialRect.h - mouseYRatio;
        break;
      case 'n':
        newAspectH = initialRect.h - mouseYRatio;
        break;
      case 'ne':
        newAspectW = initialRect.w + mouseXRatio;
        newAspectH = initialRect.h - mouseYRatio;
        break;
      case 'e':
        newAspectW = initialRect.w + mouseXRatio;
        break;
      case 'se':
        newAspectW = initialRect.w + mouseXRatio;
        newAspectH = initialRect.h + mouseYRatio;
        break;
      case 's':
        newAspectH = initialRect.h + mouseYRatio;
        break;
      case 'sw':
        newAspectW = initialRect.w - mouseXRatio;
        newAspectH = initialRect.h + mouseYRatio;
        break;
      case 'w':
        newAspectW = initialRect.w - mouseXRatio;
        break;
    }

    // Apply ratio based on which dimension changed most
    if (Math.abs(newAspectW) > Math.abs(newAspectH * targetRatio)) {
      newAspectH = newAspectW / targetRatio;
    } else {
      newAspectW = newAspectH * targetRatio;
    }

    // Now recalculate x, y, w, h considering the fixed point
    switch (activeHandle) {
      case 'nw':
        newX = initialRect.x + initialRect.w - newAspectW;
        newY = initialRect.y + initialRect.h - newAspectH;
        newW = newAspectW;
        newH = newAspectH;
        break;
      case 'n':
        newX = initialRect.x;
        newY = initialRect.y + initialRect.h - newAspectH;
        newW = initialRect.w;
        newH = newAspectH;
        break;
      case 'ne':
        newX = initialRect.x;
        newY = initialRect.y + initialRect.h - newAspectH;
        newW = newAspectW;
        newH = newAspectH;
        break;
      case 'e':
        newX = initialRect.x;
        newY = initialRect.y;
        newW = newAspectW;
        newH = initialRect.h;
        break;
      case 'se':
        newX = initialRect.x;
        newY = initialRect.y;
        newW = newAspectW;
        newH = newAspectH;
        break;
      case 's':
        newX = initialRect.x;
        newY = initialRect.y;
        newW = initialRect.w;
        newH = newAspectH;
        break;
      case 'sw':
        newX = initialRect.x + initialRect.w - newAspectW;
        newY = initialRect.y;
        newW = newAspectW;
        newH = newAspectH;
        break;
      case 'w':
        newX = initialRect.x + initialRect.w - newAspectW;
        newY = initialRect.y;
        newW = newAspectW;
        newH = initialRect.h;
        break;
    }
  }

  // Ensure minimum size
  newW = Math.max(1, newW);
  newH = Math.max(1, newH);

  state.crop.rect = {
    x: newX,
    y: newY,
    w: newW,
    h: newH
  };
}

function getHandleAtPoint(pos) {
  if (!state.crop.rect) return null;
  const r = state.crop.rect;
  const hs = HANDLE_SIZE / 2; // Half handle size for easier checks

  const handles = {
    nw: {
      x: r.x - hs,
      y: r.y - hs,
      cursor: 'nwse-resize'
    },
    n: {
      x: r.x + r.w / 2 - hs,
      y: r.y - hs,
      cursor: 'ns-resize'
    },
    ne: {
      x: r.x + r.w - hs,
      y: r.y - hs,
      cursor: 'nesw-resize'
    },
    e: {
      x: r.x + r.w - hs,
      y: r.y + r.h / 2 - hs,
      cursor: 'ew-resize'
    },
    se: {
      x: r.x + r.w - hs,
      y: r.y + r.h - hs,
      cursor: 'nwse-resize'
    },
    s: {
      x: r.x + r.w / 2 - hs,
      y: r.y + r.h - hs,
      cursor: 'ns-resize'
    },
    sw: {
      x: r.x - hs,
      y: r.y + r.h - hs,
      cursor: 'nesw-resize'
    },
    w: {
      x: r.x - hs,
      y: r.y + r.h / 2 - hs,
      cursor: 'ew-resize'
    },
  };

  for (const handleName in handles) {
    const hRect = handles[handleName];
    if (pos.x >= hRect.x && pos.x <= hRect.x + HANDLE_SIZE &&
      pos.y >= hRect.y && pos.y <= hRect.y + HANDLE_SIZE) {
      return handleName;
    }
  }
  return null;
}

function drawCropOverlay() {
  cropCtx.clearRect(0, 0, state.width, state.height);
  if (!state.crop.rect) {
    updateCropDimensionsUI();
    return;
  }

  const r = state.crop.rect;
  // Draw darkened overlay
  cropCtx.fillStyle = 'rgba(0,0,0,0.5)';
  cropCtx.fillRect(0, 0, state.width, state.height);

  // Clear area for crop selection
  cropCtx.clearRect(r.x, r.y, r.w, r.h);

  // Draw crop rectangle border
  cropCtx.strokeStyle = '#fff';
  cropCtx.lineWidth = 2; // Fixed border width regardless of zoom for visibility
  cropCtx.strokeRect(r.x, r.y, r.w, r.h);

  // Draw resize handles
  if (!state.crop.isDragging) { // Only draw handles when not actively dragging them
    cropCtx.fillStyle = '#fff';
    cropCtx.strokeStyle = '#000';
    cropCtx.lineWidth = 1;

    const hs = HANDLE_SIZE / 2;
    const handles = [
      [r.x, r.y], // nw
      [r.x + r.w / 2, r.y], // n
      [r.x + r.w, r.y], // ne
      [r.x + r.w, r.y + r.h / 2], // e
      [r.x + r.w, r.y + r.h], // se
      [r.x + r.w / 2, r.y + r.h], // s
      [r.x, r.y + r.h], // sw
      [r.x, r.y + r.h / 2] // w
    ];

    handles.forEach(p => {
      cropCtx.fillRect(p[0] - hs, p[1] - hs, HANDLE_SIZE, HANDLE_SIZE);
      cropCtx.strokeRect(p[0] - hs, p[1] - hs, HANDLE_SIZE, HANDLE_SIZE);
    });
  }

  updateCropDimensionsUI();
}

function updateCropDimensionsUI() {
  if (state.crop.rect) {
    cropDimensionsSpan.innerText = `${Math.round(state.crop.rect.w)} x ${Math.round(state.crop.rect.h)} px`;
  } else {
    cropDimensionsSpan.innerText = 'Draw rect to crop';
  }
}

function setCropCursor(e) {
  if (state.tool !== 'crop' || state.crop.isDragging) return; // Don't change cursor if not crop tool or already dragging

  const pos = getMousePos(e);
  const handle = getHandleAtPoint(pos);

  if (handle) {
    const cursors = {
      nw: 'nwse-resize',
      n: 'ns-resize',
      ne: 'nesw-resize',
      e: 'ew-resize',
      se: 'nwse-resize',
      s: 'ns-resize',
      sw: 'nesw-resize',
      w: 'ew-resize',
    };
    cropOverlay.style.cursor = cursors[handle];
  } else if (state.crop.rect && pos.x >= state.crop.rect.x && pos.x <= state.crop.rect.x + state.crop.rect.w &&
    pos.y >= state.crop.rect.y && pos.y <= state.crop.rect.y + state.crop.rect.h) {
    // Inside crop rect but not on a handle, could be 'move' for future
    cropOverlay.style.cursor = 'move'; // Or 'crosshair' to indicate new selection
  } else {
    cropOverlay.style.cursor = 'crosshair';
  }
}

function applyCrop() {
  if (!state.crop.rect || state.crop.rect.w < 1) return;
  const r = state.crop.rect;
  const newW = Math.round(r.w);
  const newH = Math.round(r.h);
  state.layers.forEach(layer => {
    const tempC = document.createElement('canvas');
    tempC.width = newW;
    tempC.height = newH;
    const tempCtx = tempC.getContext('2d');
    tempCtx.drawImage(layer.canvas, r.x - layer.x, r.y - layer.y, newW, newH, 0, 0, newW, newH);
    layer.canvas.width = newW;
    layer.canvas.height = newH;
    layer.ctx = layer.canvas.getContext('2d');
    layer.ctx.drawImage(tempC, 0, 0);
    layer.x = 0;
    layer.y = 0;
    layer.canvas.style.transform = 'translate(0,0)';
  });
  setCanvasSize(newW, newH);
  exitCropMode();
  setZoom(1.0);
  fitToScreen();
}

function exitCropMode() {
  state.crop.rect = null;
  state.crop.start = null;
  state.crop.isDragging = false;
  state.crop.isResizing = false;
  state.crop.activeHandle = null;
  state.crop.aspectRatio = 'free'; // Reset aspect ratio
  cropCtx.clearRect(0, 0, state.width, state.height);
  updateCropDimensionsUI(); // Clear dimensions text
  setTool('move'); // Always switch back to move tool
  cropOverlay.style.cursor = 'default'; // Reset cursor
  updateUI(); // To update tool and ratio buttons
}

function updateUI() {
  tools.forEach(t => {
    document.getElementById(`tool-${t}`).classList.toggle('active', state.tool === t);
  });
  document.querySelectorAll('.option-group').forEach(el => el.classList.add('hidden'));
  if (state.tool === 'brush' || state.tool === 'eraser') document.getElementById('opt-brush').classList.remove('hidden');
  if (state.tool === 'text') document.getElementById('opt-text').classList.remove('hidden');
  if (state.tool === 'crop') {
    document.getElementById('opt-crop').classList.remove('hidden');
    // Update active crop ratio button
    cropRatioButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === state.crop.aspectRatio);
    });
  }

  const active = getActiveLayer();
  if (active) {
    document.getElementById('layer-opacity').value = active.opacity * 100;
  }
}

function updateLayersUI() {
  layersList.innerHTML = '';
  state.layers.forEach(layer => {
    const el = document.createElement('div');
    el.className = `layer-item ${layer.id === state.activeLayerId ? 'active' : ''}`;
    el.onclick = () => setActiveLayer(layer.id);
    el.innerHTML = `
            <button class="layer-vis-btn ${layer.visible ? 'visible' : ''}">
              <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                <path d="${layer.visible ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.45-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4 .7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'}"/>
              </svg>
            </button>
            <span class="layer-name">${layer.name}</span>
            `;
    el.querySelector('.layer-vis-btn').onclick = (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      layer.canvas.style.display = layer.visible ? 'block' : 'none';
      updateLayersUI();
    };
    layersList.appendChild(el);
  });
  refreshLayerZIndex();
}



function setTool(t) {
  state.tool = t;
  if (t === 'crop') {
    cropOverlay.style.cursor = 'crosshair';
    state.crop.active = true;
    if (state.crop.rect) { // Redraw if a rect already exists
      drawCropOverlay();
      updateCropDimensionsUI();
    }
  } else if (t === 'text') {
    cropOverlay.style.cursor = 'text';
    state.crop.active = false; // Deactivate crop mode
    state.crop.rect = null; // Clear crop rect if switching tools
    cropCtx.clearRect(0, 0, state.width, state.height);
    updateCropDimensionsUI();
  } else {
    cropOverlay.style.cursor = 'default';
    state.crop.active = false; // Deactivate crop mode
    state.crop.rect = null; // Clear crop rect if switching tools
    cropCtx.clearRect(0, 0, state.width, state.height);
    updateCropDimensionsUI();
  }
  updateUI();
}
document.getElementById('tool-move').onclick = () => setTool('move');
document.getElementById('tool-brush').onclick = () => setTool('brush');
document.getElementById('tool-eraser').onclick = () => setTool('eraser');
document.getElementById('tool-text').onclick = () => setTool('text');
document.getElementById('tool-crop').onclick = () => setTool('crop');
document.getElementById('brush-size').oninput = (e) => state.brush.size = e.target.value;
document.getElementById('brush-color').oninput = (e) => state.brush.color = e.target.value;
document.getElementById('text-content').oninput = (e) => state.text.content = e.target.value;
document.getElementById('text-size').oninput = (e) => state.text.size = e.target.value;
document.getElementById('text-color').oninput = (e) => state.text.color = e.target.value;
document.getElementById('zoom-in').onclick = () => setZoom(state.zoom + 0.1);
document.getElementById('zoom-out').onclick = () => setZoom(state.zoom - 0.1);
document.getElementById('zoom-fit').onclick = fitToScreen;
document.getElementById('layer-opacity').oninput = (e) => {
  const l = getActiveLayer();
  if (l) {
    l.opacity = e.target.value / 100;
    l.canvas.style.opacity = l.opacity;
  }
};
document.getElementById('btn-add-layer').onclick = () => addLayer();
document.getElementById('btn-delete-layer').onclick = deleteLayer;
document.getElementById('btn-layer-up').onclick = () => moveLayerOrder(1);
document.getElementById('btn-layer-down').onclick = () => moveLayerOrder(-1);
document.getElementById('btn-apply-crop').onclick = applyCrop;
document.getElementById('btn-cancel-crop').onclick = exitCropMode;

// Crop aspect ratio buttons
cropRatioButtons.forEach(button => {
  button.onclick = () => {
    state.crop.aspectRatio = button.dataset.ratio;
    // Re-adjust existing crop rect if aspect ratio changes
    if (state.crop.rect) {
      // Simulate a drag from current position to re-apply ratio
      const currentMouse = { x: state.crop.rect.x + state.crop.rect.w, y: state.crop.rect.y + state.crop.rect.h };
      const initialMouse = { x: state.crop.rect.x, y: state.crop.rect.y };
      state.crop.initialMouseX = initialMouse.x;
      state.crop.initialMouseY = initialMouse.y;
      updateCropRect(currentMouse);
    }
    updateUI(); // Update active button style
    drawCropOverlay(); // Redraw overlay with new ratio
    updateCropDimensionsUI(); // Update dimensions
  };
});



const fileInput = document.getElementById('file-input');
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      if (state.layers.length === 1 && state.layers[0].name === "Background") {
        setCanvasSize(img.width, img.height);
        const bg = state.layers[0];
        bg.canvas.width = img.width;
        bg.canvas.height = img.height;
        bg.ctx = bg.canvas.getContext('2d');
        bg.ctx.drawImage(img, 0, 0);
        bg.name = file.name;
        updateLayersUI();
        fitToScreen();
      } else {
        addLayer(file.name, img);
      }
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
};
document.getElementById('btn-export').onclick = () => {
  const exCanvas = document.createElement('canvas');
  exCanvas.width = state.width;
  exCanvas.height = state.height;
  const exCtx = exCanvas.getContext('2d');
  state.layers.forEach(l => {
    if (l.visible) {
      exCtx.globalAlpha = l.opacity;
      exCtx.drawImage(l.canvas, l.x, l.y);
    }
  });
  const link = document.createElement('a');
  link.download = 'image.png';
  link.href = exCanvas.toDataURL();
  link.click();
};
const modal = document.getElementById('dim-modal');
const dimsGroup = document.getElementById('dims-group');
const scaleGroup = document.getElementById('scale-group');
let modalAction = null;
document.getElementById('btn-new').onclick = () => {
  document.getElementById('modal-title').innerText = "New Canvas";
  dimsGroup.classList.remove('hidden');
  scaleGroup.classList.add('hidden');
  modalAction = 'new';
  modal.classList.remove('hidden');
};
document.getElementById('btn-resize').onclick = () => {
  document.getElementById('modal-title').innerText = "Resize Canvas";
  document.getElementById('inp-width').value = state.width;
  document.getElementById('inp-height').value = state.height;
  dimsGroup.classList.remove('hidden');
  scaleGroup.classList.add('hidden');
  modalAction = 'resize';
  modal.classList.remove('hidden');
};
document.getElementById('btn-scale-layer').onclick = () => {
  if (!getActiveLayer()) return;
  document.getElementById('modal-title').innerText = "Scale Active Layer";
  dimsGroup.classList.add('hidden');
  scaleGroup.classList.remove('hidden');
  document.getElementById('inp-scale').value = 100;
  modalAction = 'scaleLayer';
  modal.classList.remove('hidden');
};
document.getElementById('btn-modal-cancel').onclick = () => modal.classList.add('hidden');
document.getElementById('btn-modal-confirm').onclick = () => {
  if (modalAction === 'new' || modalAction === 'resize') {
    const w = parseInt(document.getElementById('inp-width').value);
    const h = parseInt(document.getElementById('inp-height').value);
    if (modalAction === 'new') {
      init(w, h);
      fitToScreen();
    } else {
      const oldW = state.width;
      const oldH = state.height;
      setCanvasSize(w, h);
      state.layers.forEach(l => {
        const temp = document.createElement('canvas');
        temp.width = oldW;
        temp.height = oldH;
        temp.getContext('2d').drawImage(l.canvas, 0, 0);
        l.canvas.width = w;
        l.canvas.height = h;
        l.ctx = l.canvas.getContext('2d');
        l.ctx.drawImage(temp, 0, 0, w, h);
      });
    }
  } else if (modalAction === 'scaleLayer') {
    const scale = parseFloat(document.getElementById('inp-scale').value) / 100;
    const layer = getActiveLayer();
    if (layer && scale > 0) {
      const temp = document.createElement('canvas');
      temp.width = layer.canvas.width;
      temp.height = layer.canvas.height;
      temp.getContext('2d').drawImage(layer.canvas, 0, 0);
      const ctx = layer.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if (ctx.imageSmoothingQuality) {
        ctx.imageSmoothingQuality = "high";
      }
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.drawImage(temp, 0, 0, temp.width * scale, temp.height * scale);
      ctx.restore();
    }
  }
  modal.classList.add('hidden');
};
init();
fitToScreen();