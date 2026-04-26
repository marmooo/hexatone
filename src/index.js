import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.5.0/dist/midy.min.js";

loadConfig();

function loadConfig() {
  if (localStorage.getItem("darkMode") == 1) {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleDarkMode() {
  if (localStorage.getItem("darkMode") == 1) {
    localStorage.setItem("darkMode", 0);
    document.documentElement.setAttribute("data-bs-theme", "light");
  } else {
    localStorage.setItem("darkMode", 1);
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleHandMode(event) {
  panel.classList.toggle("single");
  if (handMode === 1) {
    handMode = 2;
    event.target.textContent = "2️⃣";
  } else {
    handMode = 1;
    event.target.textContent = "1️⃣";
  }
}

function changeLang() {
  const langObj = document.getElementById("lang");
  const lang = langObj.options[langObj.selectedIndex].value;
  location.href = `/hexatone/${lang}/`;
}

function getGlobalCSS() {
  let cssText = "";
  for (const stylesheet of document.styleSheets) {
    for (const rule of stylesheet.cssRules) {
      cssText += rule.cssText;
    }
  }
  const css = new CSSStyleSheet();
  css.replaceSync(cssText);
  return css;
}

function defineShadowElement(tagName, callback) {
  class ShadowElement extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [globalCSS];
      shadow.appendChild(
        document.getElementById(tagName).content.cloneNode(true),
      );
      callback?.(shadow, this);
    }
  }
  customElements.define(tagName, ShadowElement);
}

const globalCSS = getGlobalCSS();
defineShadowElement("midi-instrument", (shadow) => {
  shadow.querySelector("select").onchange = setProgramChange;
});
defineShadowElement("midi-drum", (shadow) => {
  shadow.querySelector("select").onchange = setProgramChange;
});

function setEffect(groupId, channel, value) {
  if (effectTypes[groupId] === "expression") {
    midy.setControlChange(channel, 11, value);
  } else {
    midy.setControlChange(channel, 74, value);
  }
}

async function setProgramChange(event) {
  const target = event.target;
  const host = target.getRootNode().host;
  const programNumber = target.selectedIndex;
  const channelNumber = (host.id === "instrument-first") ? 0 : 15;
  const channel = midy.channels[channelNumber];
  const bankNumber = channel.isDrum ? 128 : channel.bankLSB;
  const index = midy.soundFontTable[programNumber][bankNumber];
  if (index === undefined) {
    const program = programNumber.toString().padStart(3, "0");
    const baseName = bankNumber === 128 ? "128" : program;
    const path = `${soundFontURL}/${baseName}.sf3`;
    await midy.loadSoundFont(path);
  }
  midy.setProgramChange(channelNumber, programNumber);
}

function getPointerArea(event) {
  return event.width * event.height;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toMidiValue(ratio) {
  return Math.max(1, Math.round(ratio * 127));
}

function calcPitchBendRatio(event, padRect) {
  const inset = padRect.width * 0.1;
  const { clientX: x, clientY: y } = event;
  if (x < padRect.left) {
    return {
      ratio: clamp(1 + (x - padRect.left) / inset, 0, 1),
      direction: "horizontal",
    };
  }
  if (x > padRect.right) {
    return {
      ratio: clamp(1 + (padRect.right - x) / inset, 0, 1),
      direction: "horizontal",
    };
  }
  if (y < padRect.top) {
    return {
      ratio: clamp(1 + (y - padRect.top) / inset, 0, 1),
      direction: "vertical",
    };
  }
  if (y > padRect.bottom) {
    return {
      ratio: clamp(1 + (padRect.bottom - y) / inset, 0, 1),
      direction: "vertical",
    };
  }
  return null; // inside pad
}

function calcContinuousPitchBend(event, state) {
  const semitoneDiff = state.toNote - state.fromNote;
  let ratio = 1;
  if (state.targetPadHit && state.currentPadHit) {
    const fromRect = state.currentPadHit.getBoundingClientRect();
    const toRect = state.targetPadHit.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (state.bendDirection === "horizontal") {
      const overlapLeft = Math.max(fromRect.left, toRect.left);
      const overlapRight = Math.min(fromRect.right, toRect.right);
      const overlapWidth = overlapRight - overlapLeft;
      const relativeX = x - overlapLeft;
      ratio = clamp(relativeX / overlapWidth, 0, 1);
    } else if (state.bendDirection === "vertical") {
      const fromCenter = getCenter(fromRect);
      const toCenter = getCenter(toRect);
      const dirX = toCenter.x - fromCenter.x;
      const dirY = toCenter.y - fromCenter.y;
      const centerDistance = Math.sqrt(dirX * dirX + dirY * dirY);
      const normDirX = dirX / centerDistance;
      const normDirY = dirY / centerDistance;
      const r = fromRect.width / Math.sqrt(3);
      const apothem = r * Math.sqrt(3) / 2;
      const overlapLength = centerDistance - 2 * apothem;
      const overlapStartX = fromCenter.x + normDirX * apothem;
      const overlapStartY = fromCenter.y + normDirY * apothem;
      const touchVecX = x - overlapStartX;
      const touchVecY = y - overlapStartY;
      const projection = touchVecX * normDirX + touchVecY * normDirY;
      if (state.toNote > state.fromNote) {
        ratio = clamp(projection / overlapLength, 0, 1);
      } else {
        ratio = clamp(1 - projection / overlapLength, 0, 1);
      }
    }
  } else if (state.currentPadHit) {
    const padRect = state.currentPadHit.getBoundingClientRect();
    const result = calcPitchBendRatio(event, padRect);
    if (result) {
      ratio = result.ratio;
      state.bendDirection ??= result.direction;
    }
  } else {
    state.bendDirection = null;
  }
  const sensitivity = midy.channels[state.channel].state.pitchWheelSensitivity *
    128 * 2;
  return Math.round(8192 + (8192 * semitoneDiff * ratio) / sensitivity);
}

function findSharedEdge(center1, center2, r) {
  const dx = center2.x - center1.x;
  const dy = center2.y - center1.y;
  let angle = Math.atan2(dy, dx);
  const edgeDirections = [0, 60, 120, 180, 240, 300].map((deg) =>
    deg * Math.PI / 180
  );
  if (angle < 0) angle += 2 * Math.PI;
  let minDiff = Infinity;
  let edgeIndex = 0;
  for (let i = 0; i < 6; i++) {
    let diff = Math.abs(angle - edgeDirections[i]);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < minDiff) {
      minDiff = diff;
      edgeIndex = i;
    }
  }
  const vertex1Angle = (edgeIndex * 60 - 30) * Math.PI / 180;
  const vertex2Angle = ((edgeIndex + 1) * 60 - 30) * Math.PI / 180;
  return {
    x1: center1.x + r * Math.cos(vertex1Angle),
    y1: center1.y + r * Math.sin(vertex1Angle),
    x2: center1.x + r * Math.cos(vertex2Angle),
    y2: center1.y + r * Math.sin(vertex2Angle),
    edgeIndex: edgeIndex,
  };
}

function calcExpressionFromMovement(event, state) {
  if (!state.currentPadHit || !state.targetPadHit) return null;
  const currentRect = state.currentPadHit.getBoundingClientRect();
  const targetRect = state.targetPadHit.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };
  const targetCenter = {
    x: targetRect.left + targetRect.width / 2,
    y: targetRect.top + targetRect.height / 2,
  };
  const sharedEdge = findSharedEdge(currentCenter, targetCenter, hexRadius);
  const closest = closestPointOnLine(
    event.clientX,
    event.clientY,
    sharedEdge.x1,
    sharedEdge.y1,
    sharedEdge.x2,
    sharedEdge.y2,
  );
  let ratio;
  switch (sharedEdge.edgeIndex) {
    case 0: // right (horizontal)
    case 3: // left (horizontal)
      ratio = state.toNote > state.fromNote ? (1 - closest.t) : closest.t;
      break;
    default:
      ratio = sharedEdge.y1 < sharedEdge.y2 ? (1 - closest.t) : closest.t;
  }
  return toMidiValue(ratio);
}

function closestPointOnLine(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: x1, y: y1, t: 0.5 };
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return {
    x: x1 + t * dx,
    y: y1 + t * dy,
    t,
  };
}

function getCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getHitOrientation(padA, padB) {
  const c1 = getCenter(padA.getBoundingClientRect());
  const c2 = getCenter(padB.getBoundingClientRect());
  const dx = Math.abs(c1.x - c2.x);
  const dy = Math.abs(c1.y - c2.y);
  return dx > dy ? "horizontal" : "vertical";
}

function calcVelocityFromY(event, padHit) {
  const rect = padHit.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const ratio = 1 - clamp(y / rect.height, 0, 1);
  return toMidiValue(ratio);
}

function createMPEPointerState(channel, groupId) {
  return {
    groupId,
    channel,
    baseNotes: new Set(),
    padHits: new Set(),
    basePadHits: [],
    baseCenterNote: null,
    chordExpression: 64,
    initialOrientation: null,
    currentPadHit: null,
    targetPadHit: null,
    fromNote: null,
    toNote: null,
    bendPadRect: null,
    activeView: null,
    bendDirection: null,
    // aftertouch
    baseArea: 1,
    pressure: 0,
    pressureDirection: 0,
    pressureInterval: null,
    lastMoveTime: 0,
  };
}

function allocChannel(groupId) {
  if (groupId === 0) return lowerFreeChannels.shift() ?? null;
  if (groupId === 1) return upperFreeChannels.shift() ?? null;
  return null;
}

function releaseChannel(groupId, channelNumber) {
  midy.setPitchBend(channelNumber, 8192);
  setEffect(groupId, channelNumber, 64);
  if (1 <= channelNumber && channelNumber <= midy.lowerMPEMembers) {
    lowerFreeChannels.push(channelNumber);
    return;
  }
  if (15 - midy.upperMPEMembers <= channelNumber && channelNumber <= 14) {
    upperFreeChannels.push(channelNumber);
  }
}

function getOrCreateState(pointerId, groupId) {
  if (!mpePointers.has(pointerId)) {
    const channel = allocChannel(groupId);
    if (channel == null) return null;
    mpePointers.set(pointerId, createMPEPointerState(channel, groupId));
  }
  return mpePointers.get(pointerId);
}

function mpePointerDown(event, padHit, state) {
  padHit.setPointerCapture(event.pointerId);
  const note = Number(padHit.dataset.index);
  if (state.baseNotes.has(note)) return;
  if (state.baseNotes.size === 0) {
    const velocity = calcVelocityFromY(event, padHit);
    state.chordExpression = velocity;
    if (state.initialOrientation !== null) {
      const expression = calcExpressionFromMovement(event, state);
      if (expression !== null) {
        state.chordExpression = expression;
      }
    }
    setEffect(state.groupId, state.channel, state.chordExpression);
    if (afterTouchEnabled) {
      state.baseArea = getPointerArea(event);
      state.pressure = 0;
      state.pressureDirection = 0;
      midy.setChannelPressure(state.channel, 0);
      state.pressureInterval = setInterval(() => {
        const next = clamp(state.pressure + state.pressureDirection, 0, 127);
        if (next === state.pressure) return;
        state.pressure = next;
        midy.setChannelPressure(state.channel, state.pressure);
      }, 0);
    }
  }
  state.activeView = highlightPad(padHit, state.chordExpression);
  if (state.baseCenterNote == null) {
    state.baseCenterNote = note;
    midy.setPitchBend(state.channel, 8192);
  }
  midy.noteOn(state.channel, note, 127);
  state.baseNotes.add(note);
  state.padHits.add(padHit);
  state.currentPadHit = padHit;
  state.fromNote = state.baseCenterNote ?? note;
  state.toNote = note;
  state.bendPadRect = padHit.getBoundingClientRect();
}

function mpePointerUp(event) {
  const state = mpePointers.get(event.pointerId);
  if (!state) return;
  if (state.pressureInterval !== null) {
    clearInterval(state.pressureInterval);
    state.pressureInterval = null;
  }
  state.padHits.forEach(clearPadColor);
  state.baseNotes.forEach((note) => midy.noteOff(state.channel, note));
  releaseChannel(state.groupId, state.channel);
  mpePointers.delete(event.pointerId);
}

function isPointInSharedEdgeRect(event, pad1, pad2) {
  const view1 = pad1.parentNode.querySelector(".pad-view");
  const view2 = pad2.parentNode.querySelector(".pad-view");
  const rect1 = view1.getBoundingClientRect();
  const rect2 = view2.getBoundingClientRect();
  const center1 = getCenter(rect1);
  const center2 = getCenter(rect2);
  const r = rect1.width / Math.sqrt(3);
  const edge1 = findSharedEdge(center1, center2, r);
  const edge2 = findSharedEdge(center2, center1, r);
  const x1 = edge1.x1;
  const y1 = edge1.y1;
  const x2 = edge1.x2;
  const y2 = edge1.y2;
  const x3 = edge2.x1;
  const y3 = edge2.y1;
  const x4 = edge2.x2;
  const y4 = edge2.y2;
  const inTriangle = (px, py, ax, ay, bx, by, cx, cy) => {
    const v0x = cx - ax;
    const v0y = cy - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = px - ax;
    const v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0) && (v >= 0) && (u + v <= 1);
  };
  const px = event.clientX;
  const py = event.clientY;
  return inTriangle(px, py, x1, y1, x2, y2, x3, y3) ||
    inTriangle(px, py, x1, y1, x3, y3, x4, y4);
}

function findBestPairFromHits(event, hits) {
  const validPairs = [];
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      if (isPointInSharedEdgeRect(event, hits[i], hits[j])) {
        validPairs.push([hits[i], hits[j]]);
      }
    }
  }
  return validPairs.length === 1 ? validPairs[0] : null;
}

function handlePointerDown(event, panel, groupId) {
  if (!isInsidePanel(event)) return;
  panel.setPointerCapture(event.pointerId);
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  if (hits.length === 0 || hits.length > 2) {
    if (hits.length > 2) {
      const bestPair = findBestPairFromHits(event, hits);
      if (!bestPair) return;
      hits.length = 0;
      hits.push(...bestPair);
    } else {
      return;
    }
  }

  const state = getOrCreateState(event.pointerId, groupId);
  if (!state) return;
  state.baseNotes.clear();
  state.padHits.clear();
  state.baseCenterNote = null;
  state.initialOrientation = null;
  state.currentPadHit = null;
  state.targetPadHit = null;
  state.fromNote = null;
  state.toNote = null;
  state.bendDirection = null;

  if (hits.length === 2) {
    state.initialOrientation = getHitOrientation(hits[0], hits[1]);
    state.basePadHits = [hits[0], hits[1]];
    state.currentPadHit = hits[0];
    state.targetPadHit = hits[1];
    const expression = calcExpressionFromMovement(event, state);
    if (expression !== null) {
      state.chordExpression = expression;
    } else {
      state.chordExpression = 64;
    }
    setEffect(state.groupId, state.channel, state.chordExpression);
  } else {
    state.basePadHits = [];
  }

  for (const padHit of hits) {
    mpePointerDown(event, padHit, state);
  }
  mpeHitMap.set(event.pointerId, new Set(hits));
}

function handlePointerMove(event) {
  const state = mpePointers.get(event.pointerId);
  if (!state) return;
  if (afterTouchEnabled) {
    const now = event.timeStamp;
    state.lastMoveTime = now;
    const area = getPointerArea(event);
    state.pressureDirection = state.baseArea < area ? 1 : -1;
  }
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  const newHitSet = new Set(hits);
  mpeHitMap.set(event.pointerId, newHitSet);
  state.padHits.forEach((padHit) => {
    if (!newHitSet.has(padHit)) clearPadColor(padHit);
  });
  if (hits.length === 2 && state.baseNotes.size === 1) {
    const pad = hits.find((p) => Number(p.dataset.index) !== state.fromNote);
    if (pad) {
      state.toNote = Number(pad.dataset.index);
      const padA = hits.find((p) => Number(p.dataset.index) === state.fromNote);
      if (padA) {
        state.currentPadHit = padA;
        state.targetPadHit = pad;
        state.bendDirection = getHitOrientation(padA, pad);
      }
    }
  } else if (hits.length === 1) {
    const note = Number(hits[0].dataset.index);
    state.currentPadHit = hits[0];
    state.targetPadHit = null;
    state.toNote = note;
  } else if (hits.length === 0) {
    state.currentPadHit = null;
    state.targetPadHit = null;
    state.toNote = state.fromNote;
  }
  if (state.baseNotes.size > 1 && hits.length >= 1) {
    state.currentPadHit = hits[0];
    state.bendDirection = state.initialOrientation;
    if (state.basePadHits.length === 2) {
      state.currentPadHit = state.basePadHits[0];
      state.targetPadHit = state.basePadHits[1];
    } else {
      state.targetPadHit = null;
    }
    const expression = calcExpressionFromMovement(event, state);
    if (expression !== null) {
      setEffect(state.groupId, state.channel, expression);
      hits.forEach((padHit) => highlightPad(padHit, expression));
    } else {
      hits.forEach((padHit) => highlightPad(padHit, state.chordExpression));
    }
    state.padHits = newHitSet;
    return;
  }
  const bend = calcContinuousPitchBend(event, state);
  midy.setPitchBend(state.channel, bend);
  const expression = calcExpressionFromMovement(event, state);
  const vel = expression ?? state.chordExpression;
  if (expression !== null) {
    setEffect(state.groupId, state.channel, expression);
  }
  hits.forEach((p) => highlightPad(p, vel));
  state.padHits = newHitSet;
}

function handlePointerUp(event, panel) {
  if (!mpeHitMap.has(event.pointerId)) return;
  mpePointerUp(event);
  mpeHitMap.get(event.pointerId).clear();
  mpeHitMap.delete(event.pointerId);
  try {
    panel.releasePointerCapture(event.pointerId);
  } catch { /* skip */ }
}

function setMPEKeyEvents(panel, groupId) {
  panel.addEventListener(
    "pointerdown",
    (event) => handlePointerDown(event, panel, groupId),
  );
  panel.addEventListener("pointermove", handlePointerMove);
  panel.addEventListener("pointerup", (event) => handlePointerUp(event, panel));
  panel.addEventListener(
    "pointercancel",
    (event) => handlePointerUp(event, panel),
  );
}

function isInsidePanel(event) {
  const rect = panel.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function getTranslatedLabel(engLabel) {
  if (engLabel === "⬇" || engLabel === "⬆") return engLabel;
  const map = noteMap[htmlLang];
  return map[engLabel[0]] + engLabel.slice(1);
}

function parseNote(note) {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const [, name, octave] = match;
  return {
    name: name.toUpperCase(),
    octave: parseInt(octave, 10),
  };
}

function toNoteNumber(note) {
  const regex = /^([A-Ga-g])([#b]?)(\d+)$/;
  const match = note.match(regex);
  if (!match) return -1;
  let [, pitch, accidental, octave] = match;
  pitch = pitch.toUpperCase();
  octave = parseInt(octave);
  const pitchMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let noteNumber = pitchMap[pitch];
  if (accidental === "#") noteNumber += 1;
  if (accidental === "b") noteNumber -= 1;
  noteNumber += (octave + 1) * 12;
  return noteNumber;
}

function createNotePad(svg, cx, cy, r, gapPercent, label, noteNumber) {
  const g = document.createElementNS(svg.namespaceURI, "g");
  g.classList.add("hex-pad");

  const hexBg = document.createElementNS(svg.namespaceURI, "polygon");
  hexBg.setAttribute("points", hexPoints(cx, cy, r));
  hexBg.classList.add("pad-view");
  if (label.includes("#")) {
    hexBg.setAttribute("fill", "var(--bs-gray-800)");
  } else {
    hexBg.setAttribute("fill", "var(--bs-gray-600)");
  }
  hexBg.setAttribute("stroke", "none");

  const hitArea = document.createElementNS(svg.namespaceURI, "polygon");
  const hitRadius = r * (1 + gapPercent * 2);
  hitArea.setAttribute("points", hexPoints(cx, cy, hitRadius));
  hitArea.classList.add("pad-hit");
  hitArea.setAttribute("fill", "transparent");
  hitArea.dataset.index = noteNumber.toString();
  hitArea.style.cursor = "pointer";

  const text = document.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("x", cx);
  text.setAttribute("y", cy + r * 0.12);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", r * 0.35);
  text.setAttribute("fill", "var(--bs-gray-100)");
  text.classList.add("hex-text");
  text.textContent = getTranslatedLabel(label);
  text.setAttribute("pointer-events", "none");

  hexBg.dataset.label = label;
  hexBg.dataset.noteNumber = noteNumber.toString();
  g.append(hexBg, hitArea, text);
  const initialOctave = parseNote(label).octave;
  return {
    element: g,
    keyData: { hexBg, hitArea, text, label, initialOctave },
  };
}

function createOctaveButton(svg, cx, cy, r, label) {
  const g = document.createElementNS(svg.namespaceURI, "g");
  g.classList.add("hex-pad");

  const hexBg = document.createElementNS(svg.namespaceURI, "polygon");
  hexBg.setAttribute("points", hexPoints(cx, cy, r));

  if (label === "⬆") {
    hexBg.setAttribute("fill", "var(--bs-indigo)");
  } else {
    hexBg.setAttribute("fill", "var(--bs-red)");
  }
  hexBg.setAttribute("stroke", "none");
  hexBg.style.cursor = "pointer";
  hexBg.dataset.octaveButton = label;

  const text = document.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("x", cx);
  text.setAttribute("y", cy + r * 0.12);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", r * 0.35);
  text.setAttribute("fill", "var(--bs-gray-100)");
  text.textContent = label;
  text.setAttribute("pointer-events", "none");

  g.append(hexBg, text);
  return { g, hexBg, label };
}

function initGroup(group, groupId, allKeys, gapPercent, radius) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  const r = radius;
  const rScale = r * (1 + gapPercent);
  const w = Math.sqrt(3) * rScale;
  const h = 1.5 * rScale;
  const rows = baseLabels.length;
  const maxCols = Math.max(...baseLabels.map((row) => row.length));
  const octaveButtons = [];
  for (let y = 0; y < rows; y++) {
    const rowLabels = baseLabels[y];
    for (let x = 0; x < rowLabels.length; x++) {
      const label = rowLabels[x];
      if (!label) continue;
      const noteNumber = toNoteNumber(label);
      const cx = (w / 2) + x * w + (y % 2 ? w / 2 : 0);
      const cy = r + y * h;
      if (noteNumber >= 0) {
        const { element, keyData } = createNotePad(
          svg,
          cx,
          cy,
          r,
          gapPercent,
          label,
          noteNumber,
        );
        svg.appendChild(element);
        allKeys[groupId].push(keyData);
      } else {
        const result = createOctaveButton(svg, cx, cy, r, label);
        svg.appendChild(result.g);
        octaveButtons.push({ hexBg: result.hexBg, label: result.label });
      }
    }
  }
  const totalWidth = w * maxCols + (w / 2);
  const totalHeight = h * (rows - 1) + (r * 2);
  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
  group.appendChild(svg);

  octaveButtons.forEach(({ hexBg, label }) => {
    setChangeOctaveEvents(groupId, hexBg, label, allKeys[groupId]);
  });
  setMPEKeyEvents(svg, groupId);
}

function initButtons(gapPercent = 0.1, radius = 60) {
  const allKeys = [[], []];
  document.querySelectorAll(".group").forEach((group, groupId) => {
    initGroup(group, groupId, allKeys, gapPercent, radius);
  });
  return allKeys;
}

function setChangeOctaveEvents(groupId, button, buttonName, keys) {
  button.addEventListener("pointerdown", () => {
    const direction = (buttonName === "⬆") ? 1 : -1;
    const nextOctave = currOctaves[groupId] + direction;
    const canChange = keys.every(({ initialOctave }) => {
      const nextKeyOctave = initialOctave + (nextOctave - 4);
      return nextKeyOctave >= 1 && nextKeyOctave <= 11;
    });
    if (!canChange) return;
    currOctaves[groupId] = nextOctave;
    keys.forEach(({ hexBg, hitArea, text }) => {
      const noteNumber = Number(hitArea.dataset.index);
      const { name, octave } = parseNote(hexBg.dataset.label);
      const newNameEn = `${name}${octave + direction}`;
      text.textContent = getTranslatedLabel(newNameEn);
      hexBg.dataset.label = newNameEn;
      hitArea.dataset.index = (noteNumber + direction * 12).toString();
      hexBg.dataset.noteNumber = (noteNumber + direction * 12).toString();
    });
  });
}

function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 3 * i - Math.PI / 6;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
}

function setKeyColor(hexBg, velocity, isActive) {
  if (isActive) {
    const lightness = 30 + (velocity / 127) * 40;
    const color = `hsl(200, 80%, ${lightness}%)`;
    hexBg.setAttribute("fill", color);
  } else {
    const label = hexBg.dataset.label || "";
    if (label.includes("#")) {
      hexBg.setAttribute("fill", "var(--bs-gray-800)");
    } else {
      hexBg.setAttribute("fill", "var(--bs-gray-600)");
    }
  }
}

function highlightPad(padHit, velocity = 64) {
  const hexBg = padHit.parentNode.querySelector(".pad-view");
  setKeyColor(hexBg, velocity, true);
  return hexBg;
}

function clearPadColor(padHit) {
  const hexBg = padHit.parentNode.querySelector(".pad-view");
  setKeyColor(hexBg, 0, false);
}

function initConfig() {
  const ccHandlers = [
    (ch, v) => midy.setControlChange(ch, 1, v),
    (ch, v) => midy.setControlChange(ch, 76, v),
    (ch, v) => midy.setControlChange(ch, 77, v),
    (ch, v) => midy.setControlChange(ch, 78, v),
    (ch, v) => midy.setControlChange(ch, 91, v),
    (ch, v) => midy.setControlChange(ch, 93, v),
  ];
  document.getElementById("config").querySelectorAll("div.col")
    .forEach((config, groupId) => {
      const channelNumber = groupId === 0 ? 0 : 15;
      initEffect(config, groupId);
      initDrumToggle(config, channelNumber);
      initRangeControls(config, channelNumber, ccHandlers);
    });
}

function initEffect(config, groupId) {
  const form = config.querySelector("form");
  form.addEventListener("change", (event) => {
    effectTypes[groupId] = event.target.value;
  });
}

function initDrumToggle(config, channelNumber) {
  const checkbox = config.querySelector("input[role=switch]");
  checkbox.addEventListener("change", (event) => {
    config.querySelector("midi-instrument").parentNode
      .classList.toggle("d-none");
    if (event.target.checked) {
      midy.setControlChange(channelNumber, 0, 120); // bankMSB
      midy.setProgramChange(channelNumber, 0);
    } else {
      midy.setControlChange(channelNumber, 0, 121); // bankMSB
      const select = config.querySelector("midi-instrument").shadowRoot
        .querySelector("select");
      select.selectedIndex = 0;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

function initRangeControls(config, channelNumber, ccHandlers) {
  config.querySelectorAll("input[type=range]").forEach((input, j) => {
    const handler = ccHandlers[j];
    if (!handler) return;
    input.addEventListener("change", (event) => {
      handler(channelNumber, event.target.value);
    });
  });
}

const lowerFreeChannels = Array.from({ length: 7 }, (_, i) => i + 1);
const upperFreeChannels = Array.from({ length: 7 }, (_, i) => i + 8);
const mpeHitMap = new Map();
const mpePointers = new Map();

// deno-fmt-ignore
const baseLabels = [
  ["⬇", "⬇", "⬇",  "⬇",  "⬇",  "⬇",],
  ["C4", "D4", "E4", "F#4", "G#4", "A#4"],
  ["F4", "G4", "A4", "B4",  "C#4", "D#4",],
  ["C5", "D5", "E5", "F#5", "G#5", "A#5"],
  ["F5", "G5", "A5", "B5",  "C#5", "C#5",],
  ["⬆", "⬆", "⬆",  "⬆",  "⬆",  "⬆",],
];
const htmlLang = document.documentElement.lang;
const noteMap = {
  ja: { C: "ド", D: "レ", E: "ミ", F: "ファ", G: "ソ", A: "ラ", B: "シ" },
  en: { C: "C", D: "D", E: "E", F: "F", G: "G", A: "A", B: "B" },
};

const afterTouchEnabled = true;
const currOctaves = [4, 4];
const effectTypes = ["expression", "expression"];
let handMode = 1;

const hexRadius = 60;
const panel = document.getElementById("panel");
initButtons(0.2, hexRadius);

const soundFontURL = "https://soundfonts.pages.dev/GeneralUser_GS_v1.471";
const audioContext = new AudioContext();
const midy = new Midy(audioContext);
await Promise.all([
  midy.loadSoundFont(`${soundFontURL}/000.sf3`),
  midy.loadSoundFont(`${soundFontURL}/128.sf3`),
]);
for (let i = 0; i < 16; i++) {
  midy.setPitchBendRange(i, 1200);
}
midy.setBankMSB(9, 121);
midy.setProgramChange(9, 0);
midy.setMIDIPolyphonicExpression(0, 7);
midy.setMIDIPolyphonicExpression(15, 7);
initConfig();

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("toggleHandMode").onclick = toggleHandMode;
document.getElementById("lang").onchange = changeLang;
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    if (midy.audioContext.state === "running") {
      await midy.audioContext.suspend();
    }
  } else {
    if (midy.audioContext.state === "suspended") {
      await midy.audioContext.resume();
    }
  }
});
if (CSS.supports("-webkit-touch-callout: default")) { // iOS
  // prevent double click zoom
  document.addEventListener("dblclick", (event) => event.preventDefault());
  // prevent text selection
  const preventDefault = (event) => event.preventDefault();
  const panel = document.getElementById("panel");
  panel.addEventListener("touchstart", () => {
    document.addEventListener("touchstart", preventDefault, {
      passive: false,
    });
  });
  panel.addEventListener("touchend", () => {
    document.removeEventListener("touchstart", preventDefault, {
      passive: false,
    });
  });
}
