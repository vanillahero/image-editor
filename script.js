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
    isResizing: false, // True if resizing handles
    isMoving: false, // True if moving the entire crop rect
    activeHandle: null, // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w' or null
    aspectRatio: 'free', // 'free' | 'square' | '4:3' | '16:9'
    initialMouseX: 0, // Mouse X at start of drag/resize/move
    initialMouseY: 0, // Mouse Y at start of drag/resize/move
    initialRect: null // {x, y, w, h} - Rect at start of drag/resize/move
  },
  undoStack: [],
  redoStack: [],
  maxHistory: 20, // Max number of states to keep in history
  isUndoingRedoing: false // Flag to prevent saving state during undo/redo operations
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
  state.isUndoingRedoing = true; // Prevent saving initial state to undo stack twice
  state.undoStack = [];
  state.redoStack = [];
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
  state.isUndoingRedoing = false;
  saveState(); // Save the initial state
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
          saveState(); // Save state before adding new layer
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
  if (!state.isUndoingRedoing) {
    saveState();
  }
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
  updateUI(); // To update opacity slider
}


function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId);
}

function deleteLayer() {
  if (state.layers.length <= 1) return alert("Cannot delete the last layer");
  saveState(); // Save state before deleting
  const idx = state.layers.findIndex(l => l.id === state.activeLayerId);
  const layer = state.layers[idx];
  layer.canvas.remove();
  state.layers.splice(idx, 1);
  setActiveLayer(state.layers[Math.max(0, idx - 1)].id);
}


function moveLayerOrder(dir) {
  const idx = state.layers.findIndex(l => l.id === state.activeLayerId);
  if ((dir === 1 && idx < state.layers.length - 1) || (dir === -1 && idx > 0)) {
    saveState(); // Save state before reordering
    [state.layers[idx], state.layers[idx + dir]] = [state.layers[idx + dir], state.layers[idx]];
    refreshLayerZIndex();
    updateLayersUI();
  }
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
    saveState(); // Save state before placing text
    placeText(pos, layer.ctx, layer);
    return;
  }
  state.isDrawing = true;
  state.lastPos = pos;
  if (state.tool === 'brush' || state.tool === 'eraser') {
    saveState(); // Save state at the start of a drawing stroke
    draw(pos);
  } else if (state.tool === 'move') {
    saveState(); // Save state at the start of a move operation
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
    // Check if clicking a handle to resize
    const handle = getHandleAtPoint(pos);
    if (handle) {
      state.crop.isDragging = true;
      state.crop.isResizing = true;
      state.crop.isMoving = false;
      state.crop.activeHandle = handle;
      state.crop.initialMouseX = pos.x;
      state.crop.initialMouseY = pos.y;
      state.crop.initialRect = { ...state.crop.rect
      }; // Deep copy
      return;
    }

    // Check if clicking inside existing rect (for moving)
    if (pos.x >= state.crop.rect.x && pos.x <= state.crop.rect.x + state.crop.rect.w &&
      pos.y >= state.crop.rect.y && pos.y <= state.crop.rect.y + state.crop.rect.h) {
      state.crop.isDragging = true;
      state.crop.isResizing = false;
      state.crop.isMoving = true;
      state.crop.initialMouseX = pos.x;
      state.crop.initialMouseY = pos.y;
      state.crop.initialRect = { ...state.crop.rect
      }; // Store rect's initial position
      return;
    }
  }

  // If no rect, or clicking outside existing rect/handles, start new selection
  state.crop.isDragging = true;
  state.crop.isResizing = false;
  state.crop.isMoving = false;
  state.crop.activeHandle = null;
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

  if (state.crop.isMoving) {
    moveCropRect(pos);
  } else if (state.crop.isResizing) {
    resizeCropRect(pos);
  } else {
    updateCropRect(pos); // Initial selection
  }
  drawCropOverlay();
  updateCropDimensionsUI();
}


function handleCropEnd() {
  state.crop.isDragging = false;
  state.crop.isResizing = false;
  state.crop.isMoving = false; // Reset move state
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

  let w_raw = x2 - x1;
  let h_raw = y2 - y1;

  if (aspectRatio !== 'free') {
    const [ratioW, ratioH] = getAspectRatioNums(aspectRatio);
    const targetRatio = ratioW / ratioH;

    // Apply aspect ratio, prioritizing the dimension with larger absolute change
    if (Math.abs(w_raw) / targetRatio > Math.abs(h_raw)) {
      h_raw = Math.sign(h_raw) * (Math.abs(w_raw) / targetRatio);
    } else {
      w_raw = Math.sign(w_raw) * (Math.abs(h_raw) * targetRatio);
    }
  }

  let finalX = Math.min(x1, x1 + w_raw);
  let finalY = Math.min(y1, y1 + h_raw);
  let finalW = Math.abs(w_raw);
  let finalH = Math.abs(h_raw);

  // Clamp to canvas boundaries
  finalX = Math.max(0, Math.min(finalX, state.width - finalW));
  finalY = Math.max(0, Math.min(finalY, state.height - finalH));
  finalW = Math.min(finalW, state.width - finalX); // Ensure width doesn't exceed canvas
  finalH = Math.min(finalH, state.height - finalY); // Ensure height doesn't exceed canvas


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
    activeHandle,
    aspectRatio
  } = state.crop;
  if (!initialRect || !activeHandle) return;

  let fixedX, fixedY; // The point that should remain constant
  let currentX = currentPos.x;
  let currentY = currentPos.y;

  // Determine the fixed point (opposite corner of the handle being dragged)
  switch (activeHandle) {
    case 'nw':
      fixedX = initialRect.x + initialRect.w;
      fixedY = initialRect.y + initialRect.h;
      break;
    case 'n':
      fixedX = initialRect.x; // Keep original X
      fixedY = initialRect.y + initialRect.h;
      currentX = initialRect.x + initialRect.w; // Force currentX to maintain original width behavior
      break;
    case 'ne':
      fixedX = initialRect.x;
      fixedY = initialRect.y + initialRect.h;
      break;
    case 'e':
      fixedX = initialRect.x;
      fixedY = initialRect.y; // Keep original Y
      currentY = initialRect.y + initialRect.h; // Force currentY to maintain original height behavior
      break;
    case 'se':
      fixedX = initialRect.x;
      fixedY = initialRect.y;
      break;
    case 's':
      fixedX = initialRect.x; // Keep original X
      fixedY = initialRect.y;
      currentX = initialRect.x + initialRect.w; // Force currentX to maintain original width behavior
      break;
    case 'sw':
      fixedX = initialRect.x + initialRect.w;
      fixedY = initialRect.y;
      break;
    case 'w':
      fixedX = initialRect.x + initialRect.w;
      fixedY = initialRect.y; // Keep original Y
      currentY = initialRect.y + initialRect.h; // Force currentY to maintain original height behavior
      break;
    default:
      return;
  }

  let w_raw = currentX - fixedX;
  let h_raw = currentY - fixedY;

  // For N/S handles, the width should maintain its initial value unless aspect ratio demands change
  if (activeHandle === 'n' || activeHandle === 's') {
    w_raw = initialRect.w * Math.sign(w_raw || 1); // Maintain initial width magnitude, but respect sign
  }
  // For E/W handles, the height should maintain its initial value unless aspect ratio demands change
  if (activeHandle === 'e' || activeHandle === 'w') {
    h_raw = initialRect.h * Math.sign(h_raw || 1); // Maintain initial height magnitude, but respect sign
  }


  // Apply aspect ratio if active
  if (aspectRatio !== 'free') {
    const [ratioW, ratioH] = getAspectRatioNums(aspectRatio);
    const targetRatio = ratioW / ratioH;

    // Prioritize the dimension that is being actively dragged (for edge handles)
    // or the dominant change (for corner handles)
    if (activeHandle.includes('e') || activeHandle.includes('w')) { // horizontal drag
      h_raw = w_raw / targetRatio;
    } else if (activeHandle.includes('n') || activeHandle.includes('s')) { // vertical drag
      w_raw = h_raw * targetRatio;
    } else { // corner drag, pick dominant axis
      if (Math.abs(w_raw) / targetRatio > Math.abs(h_raw)) { // width change is dominant
        h_raw = Math.sign(h_raw) * (Math.abs(w_raw) / targetRatio);
      } else { // height change is dominant
        w_raw = Math.sign(w_raw) * (Math.abs(h_raw) * targetRatio);
      }
    }
  }

  // Final rectangle calculations, ensuring positive width/height
  let finalX = Math.min(fixedX, fixedX + w_raw);
  let finalY = Math.min(fixedY, fixedY + h_raw);
  let finalW = Math.abs(w_raw);
  let finalH = Math.abs(h_raw);

  // Ensure minimum size
  finalW = Math.max(1, finalW);
  finalH = Math.max(1, finalH);

  // Clamp to canvas boundaries
  finalX = Math.max(0, Math.min(finalX, state.width - finalW));
  finalY = Math.max(0, Math.min(finalY, state.height - finalH));

  state.crop.rect = {
    x: finalX,
    y: finalY,
    w: finalW,
    h: finalH
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
    // Inside crop rect but not on a handle, set to move cursor
    cropOverlay.style.cursor = 'move';
  } else {
    // Outside any rect or handle, for drawing a new selection
    cropOverlay.style.cursor = 'crosshair';
  }
}


function applyCrop() {
  if (!state.crop.rect || state.crop.rect.w < 1) return;
  saveState(); // Save state before applying crop
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
  state.crop.isDragging = false;
  state.crop.isResizing = false;
  state.crop.isMoving = false; // Reset move state
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

  updateUndoRedoButtons();
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
    saveState(); // Save state before changing opacity
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
    saveState(); // Save state before changing aspect ratio
    state.crop.aspectRatio = button.dataset.ratio;
    // Re-adjust existing crop rect if aspect ratio changes
    if (state.crop.rect) {
      // Adjust dimensions to fit new ratio, keeping top-left fixed
      let r = state.crop.rect;
      let newW = r.w;
      let newH = r.h;

      if (state.crop.aspectRatio !== 'free') {
        const [ratioW, ratioH] = getAspectRatioNums(state.crop.aspectRatio);
        const targetRatio = ratioW / ratioH;

        // Prioritize width or height based on current dimensions to fit the ratio
        if (newW / targetRatio > newH) { // Current width is proportionally larger
          newH = newW / targetRatio;
        } else { // Current height is proportionally larger
          newW = newH * targetRatio;
        }
      }
      // Update rect with new dimensions, keeping x,y fixed
      state.crop.rect = {
        x: r.x,
        y: r.y,
        w: Math.max(1, newW),
        h: Math.max(1, newH)
      };
    }
    updateUI(); // Update active button style
    drawCropOverlay(); // Redraw overlay with new ratio
    updateCropDimensionsUI(); // Update dimensions
  };
});

function getAspectRatioNums(aspectRatio) {
  if (aspectRatio === 'square') return [1, 1];
  if (aspectRatio === '4:3') return [4, 3];
  if (aspectRatio === '16:9') return [16, 9];
  return [1, 1]; // Fallback for 'free' or invalid, though 'free' should bypass this.
}

function moveCropRect(currentPos) {
  const {
    initialRect,
    initialMouseX,
    initialMouseY
  } = state.crop;
  const dx = currentPos.x - initialMouseX;
  const dy = currentPos.y - initialMouseY;

  // New x, y based on initial rect position + mouse delta
  let newX = initialRect.x + dx;
  let newY = initialRect.y + dy;

  // Clamp to canvas boundaries
  newX = Math.max(0, Math.min(newX, state.width - initialRect.w));
  newY = Math.max(0, Math.min(newY, state.height - initialRect.h));

  state.crop.rect.x = newX;
  state.crop.rect.y = newY;
}



const fileInput = document.getElementById('file-input');
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      saveState(); // Save state before changing canvas or adding layer
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
  if (modalAction === 'new') {
    const w = parseInt(document.getElementById('inp-width').value);
    const h = parseInt(document.getElementById('inp-height').value);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      alert("Please enter valid width and height.");
      return;
    }
    init(w, h); // init() calls saveState() internally
    fitToScreen();
  } else if (modalAction === 'resize') {
    const w = parseInt(document.getElementById('inp-width').value);
    const h = parseInt(document.getElementById('inp-height').value);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      alert("Please enter valid width and height.");
      return;
    }
    saveState(); // Save state before resizing
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
  } else if (modalAction === 'scaleLayer') {
    const scale = parseFloat(document.getElementById('inp-scale').value) / 100;
    if (isNaN(scale) || scale <= 0) {
      alert("Please enter a valid scale percentage.");
      return;
    }
    const layer = getActiveLayer();
    if (layer) {
      saveState(); // Save state before scaling layer
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
  updateUndoRedoButtons();
};
function saveState() {
  if (state.isUndoingRedoing) return; // Don't save state if we are currently undoing/redoing

  // Capture current state of layers, canvas dimensions, active layer etc.
  const snapshot = {
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    activeLayerId: state.activeLayerId,
    layers: state.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      opacity: layer.opacity,
      visible: layer.visible,
      imageDataURL: layer.canvas.toDataURL()
    }))
  };

  state.undoStack.push(snapshot);
  if (state.undoStack.length > state.maxHistory) {
    state.undoStack.shift(); // Remove the oldest state
  }
  state.redoStack = []; // Clear redo stack on new action
  updateUndoRedoButtons();
}

function restoreState(snapshot) {
  state.isUndoingRedoing = true; // Set flag to prevent saving
  setCanvasSize(snapshot.width, snapshot.height);
  setZoom(snapshot.zoom);

  // Clear existing layers from stage
  state.layers.forEach(layer => layer.canvas.remove());
  state.layers = [];

  // Restore layers
  snapshot.layers.forEach(savedLayer => {
    const canvas = document.createElement('canvas');
    canvas.width = state.width;
    canvas.height = state.height;
    canvas.id = `layer-${savedLayer.id}`;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = savedLayer.imageDataURL;


    const layer = {
      id: savedLayer.id,
      name: savedLayer.name,
      canvas,
      ctx,
      visible: savedLayer.visible,
      opacity: savedLayer.opacity,
      x: savedLayer.x,
      y: savedLayer.y
    };
    state.layers.push(layer);
    stage.insertBefore(canvas, cropOverlay); // Insert before overlay
    layer.canvas.style.opacity = layer.opacity;
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.transform = `translate(${layer.x}px, ${layer.y}px)`;
  });

  state.activeLayerId = snapshot.activeLayerId;
  updateLayersUI();
  updateUI();
  drawCropOverlay(); // Clear or redraw crop overlay if needed
  fitToScreen(); // Re-fit if canvas size changed

  // Reset tool as restoration might change current tool context
  setTool(state.tool);

  state.isUndoingRedoing = false; // Reset flag
  updateUndoRedoButtons();
}

function undo() {
  if (state.undoStack.length < 2) return; // Need at least 2 states to undo (current state + previous)

  const currentState = {
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    activeLayerId: state.activeLayerId,
    layers: state.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      opacity: layer.opacity,
      visible: layer.visible,
      imageDataURL: layer.canvas.toDataURL()
    }))
  };
  state.redoStack.push(currentState); // Save current state to redo stack

  state.undoStack.pop(); // Remove current state from undo stack
  const previousState = state.undoStack[state.undoStack.length - 1]; // Get the state to revert to
  restoreState(previousState);
}

function redo() {
  if (state.redoStack.length === 0) return;

  const currentState = {
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    activeLayerId: state.activeLayerId,
    layers: state.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      opacity: layer.opacity,
      visible: layer.visible,
      imageDataURL: layer.canvas.toDataURL()
    }))
  };
  state.undoStack.push(currentState); // Save current state to undo stack

  const nextState = state.redoStack.pop(); // Get the state to reapply
  restoreState(nextState);
}

function updateUndoRedoButtons() {
  document.getElementById('btn-undo').disabled = state.undoStack.length <= 1;
  document.getElementById('btn-redo').disabled = state.redoStack.length === 0;
}

document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;

// Keyboard shortcuts for undo/redo
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) { // Ctrl for Windows/Linux, Meta for macOS
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      redo();
    }
  }
});

init();
fitToScreen();