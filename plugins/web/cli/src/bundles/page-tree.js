"use strict";
window.__visualTree = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/content/visual-tree.ts
  var visual_tree_exports = {};
  __export(visual_tree_exports, {
    assignPositionalIds: () => assignPositionalIds,
    captureVisualTree: () => captureVisualTree,
    clippedAway: () => clippedAway,
    collapseSingleChildren: () => collapseSingleChildren,
    deltaE: () => deltaE,
    detectRootBackground: () => detectRootBackground,
    enrichOverlayMetadata: () => enrichOverlayMetadata,
    formatTreeAsText: () => formatTreeAsText,
    hiddenStyle: () => hiddenStyle,
    overflowClip: () => overflowClip,
    isContainedIn: () => isContainedIn,
    isDefaultBackground: () => isDefaultBackground,
    layoutChildren: () => layoutChildren,
    parseRgb: () => parseRgb,
    processTree: () => processTree,
    promoteEscapedNodes: () => promoteEscapedNodes,
    pruneZeroHeightLeaves: () => pruneZeroHeightLeaves,
    resolvePageBackground: () => resolvePageBackground,
    rgbToLab: () => rgbToLab
  });

  // src/content/css-selector.ts
  function getCssSelector(element, options = {}) {
    const { optimized = true } = options;
    if (!(element instanceof Element)) {
      return "";
    }
    const steps = [];
    let currentElement = element;
    while (currentElement) {
      const step = getCssSelectorStep(currentElement, optimized, currentElement === element);
      if (!step) {
        break;
      }
      steps.push(step);
      if (step.optimized) {
        break;
      }
      currentElement = currentElement.parentElement;
    }
    steps.reverse();
    return steps.map((s) => s.value).join(" > ");
  }
  function getCssSelectorStep(element, optimized, isTargetNode) {
    if (!(element instanceof Element)) {
      return null;
    }
    const id = element.id;
    const nodeName = element.localName;
    if (optimized && id) {
      return { value: idSelector(id), optimized: true };
    }
    if (optimized && (nodeName === "body" || nodeName === "head" || nodeName === "html")) {
      return { value: nodeName, optimized: true };
    }
    if (id) {
      return { value: nodeName + idSelector(id), optimized: true };
    }
    const parent = element.parentElement;
    if (!parent || element.parentNode === document) {
      return { value: nodeName, optimized: true };
    }
    const ownClassNames = getClassNames(element);
    let needsClassNames = false;
    let needsNthChild = false;
    let ownIndex = -1;
    let elementIndex = -1;
    const siblings = parent.children;
    for (let i = 0; i < siblings.length && (ownIndex === -1 || !needsNthChild); i++) {
      const sibling = siblings[i];
      elementIndex++;
      if (sibling === element) {
        ownIndex = elementIndex;
        continue;
      }
      if (needsNthChild) {
        continue;
      }
      if (sibling.localName !== nodeName) {
        continue;
      }
      needsClassNames = true;
      if (ownClassNames.length === 0) {
        needsNthChild = true;
        continue;
      }
      const siblingClassNames = new Set(getClassNames(sibling));
      const uniqueClasses = ownClassNames.filter((c) => !siblingClassNames.has(c));
      if (uniqueClasses.length === 0) {
        needsNthChild = true;
      }
    }
    let result = nodeName;
    if (isTargetNode && nodeName === "input" && element.getAttribute("type") && !id && ownClassNames.length === 0) {
      result += "[type=" + CSS.escape(element.getAttribute("type")) + "]";
    }
    if (needsNthChild) {
      result += ":nth-child(" + (ownIndex + 1) + ")";
    } else if (needsClassNames && ownClassNames.length > 0) {
      for (const className of ownClassNames) {
        result += "." + CSS.escape(className);
      }
    }
    return { value: result, optimized: false };
  }
  function getClassNames(element) {
    const classAttr = element.getAttribute("class");
    if (!classAttr) {
      return [];
    }
    return classAttr.split(/\s+/).filter(Boolean);
  }
  function idSelector(id) {
    return "#" + CSS.escape(id);
  }

  // src/content/layout-detection.ts
  function detectLayout(boxes) {
    if (boxes.length < 2) return void 0;
    if (hasSignificantOverlap(boxes)) return void 0;
    const sorted = [...boxes].sort((a, b) => a.y - b.y);
    const minHeight = Math.min(...sorted.map((b) => b.height));
    const tolerance = minHeight * 0.5;
    const rows = [];
    let currentRow = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].y - currentRow[0].y) <= tolerance) {
        currentRow.push(sorted[i]);
      } else {
        rows.push(currentRow);
        currentRow = [sorted[i]];
      }
    }
    rows.push(currentRow);
    const maxCols = Math.max(...rows.map((r) => r.length));
    if (maxCols < 2) return void 0;
    return `${maxCols}x${rows.length}`;
  }
  function hasSignificantOverlap(boxes) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const overlapArea = getOverlapArea(boxes[i], boxes[j]);
        const smallerArea = Math.min(
          boxes[i].width * boxes[i].height,
          boxes[j].width * boxes[j].height
        );
        if (smallerArea > 0 && overlapArea / smallerArea > 0.5) {
          return true;
        }
      }
    }
    return false;
  }
  function getOverlapArea(a, b) {
    const xOverlap = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    );
    const yOverlap = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    );
    return xOverlap * yOverlap;
  }

  // src/content/visual-tree.ts
  function isDefaultBackground(bg) {
    if (bg.type !== "color") return false;
    const v = bg.value;
    return v === "rgba(0, 0, 0, 0)" || v === "transparent" || v === "rgb(255, 255, 255)";
  }
  function resolvePageBackground(treeRootBg, directDetectionBg) {
    if (treeRootBg && !isDefaultBackground(treeRootBg)) {
      return treeRootBg;
    }
    return directDetectionBg;
  }
  function detectRootBackground() {
    const elements = [document.body, document.documentElement];
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      const bgImage = style.backgroundImage;
      const bgColor = style.backgroundColor;
      const bgRaw = style.background;
      if (bgImage && bgImage !== "none") {
        if (bgImage.includes("gradient(")) {
          return {
            type: "gradient",
            value: bgImage,
            raw: bgRaw,
            source: "css"
          };
        }
        if (bgImage.includes("url(")) {
          const url = bgImage.match(/url\(["']?(.+?)["']?\)/)?.[1] ?? bgImage;
          return {
            type: "image",
            value: url,
            raw: bgRaw,
            source: "css"
          };
        }
      }
      if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent" && bgColor !== "rgb(255, 255, 255)") {
        return {
          type: "color",
          value: bgColor,
          raw: bgRaw,
          source: "css"
        };
      }
    }
    return void 0;
  }
  function processTree(root) {
    collapseSingleChildren(root);
    pruneZeroHeightLeaves(root);
    const promotedToRoot = promoteEscapedNodes(root);
    const nodeMap = {};
    assignPositionalIds(root, "r", nodeMap);
    enrichOverlayMetadata(root, nodeMap, promotedToRoot);
    return { root, nodeMap, promotedToRoot };
  }
  function captureVisualTree(minWidth = 900) {
    const { root, nodeMap } = processTree(buildVisualNode(document.body, minWidth));
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    const rootBackground = bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent" ? bodyBg : htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" && htmlBg !== "transparent" ? htmlBg : "rgb(255, 255, 255)";
    const rootBackgroundInfo = resolvePageBackground(
      root.background,
      detectRootBackground()
    );
    const overlayIds = /* @__PURE__ */ new Set();
    for (const [id, info] of Object.entries(nodeMap)) {
      if (info.overlay) overlayIds.add(id);
    }
    const textFormat = formatTreeAsText(root, 0, "r", rootBackground, overlayIds);
    return {
      data: root,
      textFormat,
      nodeMap,
      rootBackground,
      rootBackgroundInfo
    };
  }
  function parseRgb(color) {
    const match = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  function rgbToLab(rgb) {
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const rl = toLinear(rgb[0]);
    const gl = toLinear(rgb[1]);
    const bl = toLinear(rgb[2]);
    let x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
    let y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
    let z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
    x /= 0.95047;
    y /= 1;
    z /= 1.08883;
    const f = (t) => t > 8856e-6 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
    const L = 116 * f(y) - 16;
    const a = 500 * (f(x) - f(y));
    const bVal = 200 * (f(y) - f(z));
    return [L, a, bVal];
  }
  function deltaE(color1, color2) {
    const rgb1 = parseRgb(color1);
    const rgb2 = parseRgb(color2);
    if (!rgb1 || !rgb2) return Infinity;
    const lab1 = rgbToLab(rgb1);
    const lab2 = rgbToLab(rgb2);
    return Math.sqrt(
      (lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2
    );
  }
  // checkVisibility() does not read clip-paths: a closed menu clipped to nothing still
  // has its box and its background.
  function clippedAway(style, rect) {
    const clip = style.clipPath;
    if (!clip || clip === "none") return false;
    if (/^circle\(0(px|%)?[\s)]/.test(clip)) return true;
    const inset = clip.match(/^inset\(([^)]*)\)/);
    if (!inset) return false;
    const parts = inset[1].split(/\sround\s/)[0].trim().split(/\s+/);
    // Only plain lengths are read; calc() and the like count as not clipped.
    if (parts.length > 4 || !parts.every((v) => /^-?[\d.]+(px|%)$|^0$/.test(v))) return false;
    const [t, r = t, b = t, l = r] = parts;
    const px = (v, size) => v.endsWith("%") ? size * parseFloat(v) / 100 : parseFloat(v);
    return rect.width - px(l, rect.width) - px(r, rect.width) <= 0 || rect.height - px(t, rect.height) - px(b, rect.height) <= 0;
  }
  function hiddenStyle(style, rect) {
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || clippedAway(style, rect);
  }
  function containsFixed(s) {
    return s.transform !== "none" || s.perspective !== "none" || s.filter !== "none" || !!s.backdropFilter && s.backdropFilter !== "none" || /paint|layout|strict|content/.test(s.contain || "") || /transform|perspective|filter/.test(s.willChange || "") || !!s.containerType && s.containerType !== "normal";
  }
  // The region, in page coordinates, that overflow-clipping ancestors leave visible. An
  // ancestor clips an element only from the element's containing block outwards: an absolute
  // menu escapes a static `overflow: hidden` trigger, a fixed banner escapes all but transforms.
  function overflowClip(element, getStyle = (el) => window.getComputedStyle(el)) {
    const clip = {};
    let position = getStyle(element).position;
    for (let a = element.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getStyle(a);
      if (s.display === "contents") continue;
      const isBlock = position === "fixed" ? containsFixed(s) : position === "absolute" ? s.position !== "static" || containsFixed(s) : true;
      if (!isBlock) continue;
      position = s.position;
      if (s.display === "inline") continue;
      const r = a.getBoundingClientRect();
      const left = r.left + a.clientLeft + window.scrollX;
      const top = r.top + a.clientTop + window.scrollY;
      if (s.overflowX !== "visible") narrow(clip, "x", "width", left, a.clientWidth);
      if (s.overflowY !== "visible") narrow(clip, "y", "height", top, a.clientHeight);
    }
    return "x" in clip || "y" in clip ? clip : void 0;
  }
  function narrow(clip, pos, size, start, length) {
    const lo = Math.max(clip[pos] ?? -Infinity, start);
    const hi = Math.min(clip[pos] === void 0 ? Infinity : clip[pos] + clip[size], start + length);
    clip[pos] = Math.round(lo);
    clip[size] = Math.max(0, Math.round(hi - lo));
  }
  // The part of a box its clip leaves visible; null when nothing is.
  function visiblePart(bounds, clip) {
    if (!clip) return bounds;
    const out = { ...bounds };
    for (const [pos, size] of [["x", "width"], ["y", "height"]]) {
      if (clip[pos] === void 0) continue;
      const lo = Math.max(bounds[pos], clip[pos]);
      const hi = Math.min(bounds[pos] + bounds[size], clip[pos] + clip[size]);
      if (hi <= lo) return null;
      out[pos] = lo;
      out[size] = hi - lo;
    }
    return out;
  }
  // An element with `display: contents` has no box of its own: its children are laid
  // out as its parent's. For the tree it is transparent, its children walked in its place.
  function layoutChildren(element, getStyle = (el) => window.getComputedStyle(el)) {
    const out = [];
    for (const child of element.children) {
      if (getStyle(child).display === "contents") out.push(...layoutChildren(child, getStyle));
      else out.push(child);
    }
    return out;
  }
  function buildVisualNode(element, minWidth) {
    if (element.id?.startsWith("vibe-blueprint-")) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const style = window.getComputedStyle(element);
    if (hiddenStyle(style, rect)) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    const selector = getCssSelector(element);
    const node = {
      tag: element.tagName,
      selector,
      bounds: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      children: []
    };
    if (element.id) {
      node.id = element.id;
    }
    if (element.classList.length > 0) {
      node.className = [...element.classList].join(" ");
    }
    if (style.position === "fixed") {
      node.fixed = true;
    }
    const clip = overflowClip(element);
    const seen = visiblePart(node.bounds, clip);
    if (!seen) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    if (seen !== node.bounds && !isContainedIn(node.bounds, seen)) {
      node.clip = clip;
    }
    const role = element.getAttribute("role");
    if (role) {
      node.role = role;
    }
    const textContent = getDirectTextContent(element);
    if (textContent) {
      node.text = textContent.slice(0, 30);
    }
    const bgImage = style.backgroundImage;
    const bgColor = style.backgroundColor;
    const bgRaw = style.background;
    if (bgImage && bgImage !== "none") {
      if (bgImage.includes("gradient(")) {
        node.background = {
          type: "gradient",
          value: bgImage,
          raw: bgRaw,
          source: "css"
        };
      } else if (bgImage.includes("url(")) {
        const url = bgImage.match(/url\(["']?(.+?)["']?\)/)?.[1] ?? bgImage;
        node.background = {
          type: "image",
          value: url,
          raw: bgRaw,
          source: "css"
        };
      }
    }
    if (!node.background && bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") {
      node.background = {
        type: "color",
        value: bgColor,
        raw: bgRaw,
        source: "css"
      };
    }
    if (!node.background) {
      const parentArea = rect.width * rect.height;
      if (parentArea > 0) {
        for (const child of element.children) {
          if (child.tagName !== "IMG") continue;
          const imgRect = child.getBoundingClientRect();
          const imgArea = imgRect.width * imgRect.height;
          if (imgArea / parentArea >= 0.75) {
            const src = child.getAttribute("src") || "";
            node.background = {
              type: "image",
              value: src,
              raw: "",
              source: "img"
            };
            break;
          }
        }
      }
    }
    const laidOut = layoutChildren(element);
    for (const child of laidOut) {
      const childRect = child.getBoundingClientRect();
      const passesWidth = childRect.width >= minWidth;
      const isFixed = !passesWidth && window.getComputedStyle(child).position === "fixed";
      if (passesWidth || isFixed) {
        const childMinWidth = isFixed ? 0 : minWidth;
        const childNode = buildVisualNode(child, childMinWidth);
        if (childNode.bounds.width > 0 || childNode.children.length > 0) {
          node.children.push(childNode);
        }
      }
    }
    const allChildBoxes = [];
    for (const child of laidOut) {
      if (child.id?.startsWith("vibe-blueprint-")) continue;
      const childStyle = window.getComputedStyle(child);
      const childRect = child.getBoundingClientRect();
      if (hiddenStyle(childStyle, childRect)) continue;
      if (childRect.width > 0 && childRect.height > 0) {
        allChildBoxes.push({
          x: Math.round(childRect.left + scrollX),
          y: Math.round(childRect.top + scrollY),
          width: Math.round(childRect.width),
          height: Math.round(childRect.height)
        });
      }
    }
    const layout = detectLayout(allChildBoxes);
    if (layout) {
      node.layout = layout;
    }
    if (node.children.length === 0 && !node.text) {
      const fullText = (element.textContent || "").replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
      if (fullText) {
        node.text = fullText.slice(0, 30);
      }
    }
    // Skip links and other visually hidden content sit wholly above or left of the page.
    // Leaves only: a box at or off the edge can hold descendants positioned on the page.
    const offPage = rect.bottom + scrollY <= 0 || rect.right + scrollX <= 0;
    if ((node.bounds.width === 0 || node.bounds.height === 0 || offPage) && node.children.length === 0) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    return node;
  }
  function collapseSingleChildren(node) {
    for (const child of node.children) {
      collapseSingleChildren(child);
    }
    while (node.children.length === 1) {
      const child = node.children[0];
      // Stop when the child escapes: a dropdown or an overlay is a node of its own.
      const parentHasArea = node.bounds.width > 0 && node.bounds.height > 0;
      if (child.fixed || parentHasArea && !staysIn(child, node)) break;
      node.collapsed = node.collapsed || [identityOf(node)];
      node.collapsed.push(...child.collapsed || [identityOf(child)]);
      if (!node.text && child.text) {
        node.text = child.text;
      }
      if (!node.layout && child.layout) {
        node.layout = child.layout;
      }
      if (!node.background && child.background) {
        node.background = child.background;
      }
      if (!parentHasArea) {
        node.bounds = child.bounds;
        if (child.clip) node.clip = child.clip;
        else delete node.clip;
        node.tag = child.tag;
        node.selector = child.selector;
        if (child.id) node.id = child.id;
        else delete node.id;
        if (child.className) node.className = child.className;
        else delete node.className;
        if (child.role) node.role = child.role;
      }
      node.children = child.children;
    }
  }
  function identityOf(node) {
    const id = { tag: node.tag, selector: node.selector };
    if (node.id) id.id = node.id;
    if (node.className) id.className = node.className;
    return id;
  }
  function pruneZeroHeightLeaves(node) {
    for (const child of node.children) {
      pruneZeroHeightLeaves(child);
    }
    node.children = node.children.filter((child) => {
      const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
      const hasChildren = child.children.length > 0;
      return hasArea || hasChildren;
    });
  }
  var CONTAINMENT_TOLERANCE = 2;
  var CONTAINED_SHARE = 0.9;
  // Exactly inside, or mostly inside: a grid row overhangs its container by a gutter.
  function isContainedIn(child, parent) {
    const t = CONTAINMENT_TOLERANCE;
    if (child.x >= parent.x - t && child.y >= parent.y - t && child.x + child.width <= parent.x + parent.width + t && child.y + child.height <= parent.y + parent.height + t) {
      return true;
    }
    const area = child.width * child.height;
    if (area === 0) return false;
    const w = Math.min(child.x + child.width, parent.x + parent.width) - Math.max(child.x, parent.x);
    const h = Math.min(child.y + child.height, parent.y + parent.height) - Math.max(child.y, parent.y);
    if (w <= 0 || h <= 0) return false;
    return w * h / area >= CONTAINED_SHARE;
  }
  // Only the visible part of a clipped child can escape: carousels, marquees, scrollers.
  function staysIn(child, parent) {
    if (isContainedIn(child.bounds, parent.bounds)) return true;
    const seen = visiblePart(child.bounds, child.clip);
    return !seen || isContainedIn(seen, parent.bounds);
  }
  function promoteEscapedNodes(root) {
    const promotedToRoot = /* @__PURE__ */ new Set();
    function walk(node, ancestors) {
      const stayed = [];
      const escaped = [];
      for (const child of node.children) {
        if (!child.fixed && staysIn(child, node)) {
          stayed.push(child);
        } else {
          escaped.push(child);
        }
      }
      node.children = stayed;
      for (const child of escaped) {
        let depth = 0;
        for (let i = ancestors.length - 1; i > 0 && !child.fixed; i--) {
          if (staysIn(child, ancestors[i])) {
            depth = i;
            break;
          }
        }
        ancestors[depth].children.push(child);
        if (depth === 0) {
          promotedToRoot.add(child);
        }
        // Its new parent's loop has already started: walk the moved subtree from its new place.
        walk(child, ancestors.slice(0, depth + 1));
      }
      for (const child of [...node.children]) {
        walk(child, [...ancestors, node]);
      }
      node.children = node.children.filter((child) => {
        const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
        const hasChildren = child.children.length > 0;
        return hasArea || hasChildren;
      });
    }
    const originalChildren = [...root.children];
    root.children = [...originalChildren];
    for (const child of [...root.children]) {
      walk(child, [root]);
    }
    root.children = root.children.filter((child) => {
      const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
      const hasChildren = child.children.length > 0;
      return hasArea || hasChildren;
    });
    return promotedToRoot;
  }
  function boundsIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function enrichOverlayMetadata(root, nodeMap, promotedToRoot) {
    if (promotedToRoot.size === 0) return;
    const childIdMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < root.children.length; i++) {
      childIdMap.set(root.children[i], `rc${i + 1}`);
    }
    for (const promoted of promotedToRoot) {
      const promotedId = childIdMap.get(promoted);
      if (!promotedId || !nodeMap[promotedId]) continue;
      const occluding = [];
      for (const sibling of root.children) {
        if (sibling === promoted) continue;
        if (promotedToRoot.has(sibling)) continue;
        const siblingId = childIdMap.get(sibling);
        if (!siblingId) continue;
        if (boundsIntersect(promoted.bounds, sibling.bounds)) {
          occluding.push(siblingId);
        }
      }
      if (occluding.length > 0) {
        nodeMap[promotedId].overlay = { occluding };
      }
    }
  }
  function getDirectTextContent(element) {
    let text = "";
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += (node.textContent || "").replace(/[\n\r\t]+/g, " ") + " ";
      }
    }
    return text.replace(/\s{2,}/g, " ").trim();
  }
  function assignPositionalIds(node, prefix, nodeMap) {
    const info = { selector: node.selector };
    if (node.background) {
      info.background = node.background;
    }
    nodeMap[prefix] = info;
    for (let i = 0; i < node.children.length; i++) {
      const childId = `${prefix}c${i + 1}`;
      assignPositionalIds(node.children[i], childId, nodeMap);
    }
  }
  var DELTA_E_THRESHOLD = 5;
  function formatTreeAsText(node, depth, nodeId, rootBackground, overlayIds) {
    const indent = "  ".repeat(depth);
    let descriptor = nodeId;
    if (node.role) descriptor += ` [${node.role}]`;
    if (node.layout) descriptor += ` [${node.layout}]`;
    if (node.background) {
      const isOverlay = overlayIds?.has(nodeId) ?? false;
      const skipInText = !isOverlay && node.background.type === "color" && rootBackground !== void 0 && deltaE(node.background.value, rootBackground) < DELTA_E_THRESHOLD;
      if (!skipInText) {
        descriptor += ` [bg:${node.background.type}]`;
      }
    }
    descriptor += ` @${node.bounds.x},${node.bounds.y}`;
    descriptor += ` ${node.bounds.width}x${node.bounds.height}`;
    if (node.text) {
      descriptor += ` "${node.text}${node.text.length >= 30 ? "..." : ""}"`;
    }
    let result = `${indent}${descriptor}
`;
    for (let i = 0; i < node.children.length; i++) {
      const childId = `${nodeId}c${i + 1}`;
      result += formatTreeAsText(node.children[i], depth + 1, childId, rootBackground, overlayIds);
    }
    return result;
  }
  return __toCommonJS(visual_tree_exports);
})();
/**
 * CSS Selector Generator
 *
 * Extracted from Chrome DevTools (DOMPath.ts) and adapted for TypeScript.
 * Generates a unique CSS selector for any DOM element.
 *
 * @license BSD-3-Clause (Chrome DevTools)
 */
