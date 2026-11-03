//# sourceURL=/detect.js
(() => {
  // src/utils/logger.js
  {
    const patchArgs = (args) => {
      if (typeof args[0] === "string" && !args[0].startsWith("[detect]")) {
        args[0] = `[detect] ${args[0]}`;
      }
    };
    const _log = console.log;
    console.log = (...args) => {
      patchArgs(args);
      _log(...args);
    };
    console.debug = (...args) => {
      if (window.DEBUG) {
        patchArgs(args);
        _log(...args);
      }
    };
    const _warn = console.warn;
    console.warn = (...args) => {
      patchArgs(args);
      _warn(...args);
    };
    const _error = console.error;
    console.error = (...args) => {
      patchArgs(args);
      _error(...args);
    };
  }

  // src/utils/color.js
  function valueToHex(c) {
    return c.toString(16);
  }
  function rgbaToHex(r, g, b, a) {
    return valueToHex(r) + valueToHex(g) + valueToHex(b) + valueToHex(a);
  }
  var Color = class _Color {
    constructor({
      r,
      g,
      b,
      a = 1,
      name = ""
    }) {
      this.name = name;
      this.r = r;
      this.g = g;
      this.b = b;
      this.a = a;
    }
    toHex() {
      return rgbaToHex(this.r, this.g, this.b, this.a);
    }
    static fromRGBA(rgbaStr) {
      const rgba = rgbaStr.replace("rgba(", "").replace(")", "").split(",").map((v) => parseInt(v.trim(), 10));
      return new _Color({
        r: rgba[0],
        g: rgba[1],
        b: rgba[2],
        a: rgba[3]
      });
    }
    toRGBA() {
      return `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
    }
    withAlpha(a) {
      return new _Color({
        ...this,
        a
      });
    }
    static random(withAlpha = false) {
      const r = Math.round(Math.random() * 255);
      const g = Math.round(Math.random() * 255);
      const b = Math.round(Math.random() * 255);
      const a = withAlpha ? Math.random() : 1;
      return new _Color({
        name: `rand-${r}-${g}-${b}-${a}`,
        r,
        g,
        b,
        a
      });
    }
    static fromHex(hex) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const a = parseInt(hex.substring(6, 8), 16);
      return new _Color({
        name: `hex-${r}-${g}-${b}-${a}`,
        r,
        g,
        b,
        a
      });
    }
  };

  // src/utils/box.js
  function calculateSurfacePercentage(mainRect, innerRect) {
    const intersectionX = Math.max(
      0,
      Math.min(mainRect.x + mainRect.width, innerRect.x + innerRect.width) - Math.max(mainRect.x, innerRect.x)
    );
    const intersectionY = Math.max(
      0,
      Math.min(mainRect.y + mainRect.height, innerRect.y + innerRect.height) - Math.max(mainRect.y, innerRect.y)
    );
    const intersectionArea = intersectionX * intersectionY;
    const innerArea = innerRect.width * innerRect.height;
    const percentage = intersectionArea / innerArea * 100;
    return percentage;
  }
  function getOffset(el, window2) {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left + window2.document.scrollingElement.scrollLeft,
      top: rect.top + window2.document.scrollingElement.scrollTop
    };
  }
  function countColumns(boxes) {
    if (!boxes.length) return 0;
    const columns = [];
    boxes.slice().sort((a, b) => {
      if (a.x !== b.x) {
        return a.x - b.x;
      }
      return a.width - b.width;
    }).forEach((box) => {
      const boxStart = box.x;
      const boxEnd = box.x + box.width;
      const latestRow = columns[columns.length - 1];
      if (latestRow) {
        if (boxStart >= latestRow - 50) {
          columns.push(boxEnd);
        }
      } else {
        columns.push(boxEnd);
      }
    });
    return columns.length;
  }
  function countRows(boxes) {
    if (!boxes.length) return 0;
    const rows = [];
    boxes.slice().sort((a, b) => a.y - b.y).forEach((box) => {
      const boxStart = box.y;
      const boxEnd = box.y + box.height;
      const latestRow = rows[rows.length - 1];
      if (latestRow) {
        if (boxStart >= latestRow - 5) {
          rows.push(boxEnd);
        }
      } else {
        rows.push(boxEnd);
      }
    });
    return rows.length;
  }
  var Box = class _Box {
    // constructor
    constructor(x, y, w, h, div) {
      this.id = crypto.randomUUID();
      this.x = Math.floor(x);
      this.y = Math.floor(y);
      this.width = Math.floor(w);
      this.height = Math.floor(h);
      this.div = div;
      this.children = [];
      this.prediction = null;
      this.layout = null;
    }
    static fromDiv(div, window2) {
      const rect = div.getBoundingClientRect();
      const offset = getOffset(div, window2);
      return new _Box(offset.left, offset.top, rect.width, rect.height, div);
    }
    // TODO - implement this
    // static areBoxesLaidOutAsGrid(boxes) {
    //   console.log('areBoxesLaidOutAsGrid');
    //   try {
    //     if (boxes.length < 2) {
    //       // If there's only one box, it's not a grid
    //       return false;
    //     }
    //     // Sort boxes based on their x and y coordinates
    //     const sortedByX = boxes.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    //     const sortedByY = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    //     console.log(sortedByX);
    //     console.log(sortedByY);
    //     // Check horizontal alignment
    //     const horizontalSpacing = [];
    //     for (let i = 1; i < sortedByX.length; i += 1) {
    //       horizontalSpacing.push(sortedByX[i].x - sortedByX[i - 1].x);
    //     }
    //     const uniqueHorizontalSpacings = [...new Set(horizontalSpacing)];
    //     if (uniqueHorizontalSpacings.length > 1) {
    //       return false;
    //     }
    //     // Check vertical alignment
    //     const verticalSpacing = [];
    //     for (let i = 1; i < sortedByY.length; i += 1) {
    //       verticalSpacing.push(sortedByY[i].y - sortedByY[i - 1].y);
    //     }
    //     const uniqueVerticalSpacings = [...new Set(verticalSpacing)];
    //     if (uniqueVerticalSpacings.length > 1) {
    //       return false;
    //     }
    //     return true;
    //   } finally {
    //     return true;
    //   }
    // }
    // methods
    contains(box, strict = true) {
      if (strict) {
        return box.x - box.width >= this.x - this.width && box.x + box.width <= this.x + this.width && box.y - box.height >= this.y - this.height && box.y + box.height <= this.y + this.height;
      } else {
        return calculateSurfacePercentage(this, box) > 75;
      }
    }
    intersects(range) {
      return !(range.x - range.width > this.x + this.width || range.x + range.width < this.x - this.width || range.y - range.height > this.y + this.height || range.y + range.height < this.y - this.height);
    }
    isInside(box) {
      return box.x - box.width <= this.x - this.width && box.x + box.width >= this.x + this.width && box.y - box.height <= this.y - this.height && box.y + box.height >= this.y + this.height;
    }
    addChild(box) {
      this.children.push(box);
    }
    determineLayout() {
      this.layout = {
        numCols: countColumns(this.children),
        numRows: countRows(this.children)
      };
      return this.layout;
    }
    toJSONString() {
      function cleanUpBoxObject(box) {
        return {
          id: box.id,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          layout: box.layout,
          prediction: box.prediction,
          template: box.template,
          xpath: box.xpath,
          xpathWithDetails: box.xpathWithDetails,
          children: box.children.map(cleanUpBoxObject)
        };
      }
      const j = cleanUpBoxObject(this);
      console.log(j);
      return j;
    }
  };

  // src/utils/dom.js
  var DOM = class _DOM {
    static getXPath(el, document2, withDetails = false) {
      const allNodes = document2.getElementsByTagName("*");
      const segs = [];
      for (let elm = el; elm && elm.nodeType === 1; elm = elm.parentNode) {
        if (withDetails) {
          if (elm.hasAttribute("id")) {
            let uniqueIdCount = 0;
            for (let n = 0; n < allNodes.length; n += 1) {
              if (allNodes[n].hasAttribute("id") && allNodes[n].id === elm.id) {
                uniqueIdCount += 1;
              }
              if (uniqueIdCount > 1) {
                break;
              }
            }
            if (uniqueIdCount === 1) {
              segs.unshift(`id("${elm.getAttribute("id")}")`);
              return segs.join("/");
            } else {
              segs.unshift(`${elm.localName.toLowerCase()}[@id="${elm.getAttribute("id")}"]`);
            }
          } else if (elm.hasAttribute("class")) {
            segs.unshift(`${elm.localName.toLowerCase()}[@class="${[...elm.classList].join(" ").trim()}"]`);
          }
        } else {
          let i = 1;
          for (let sib = elm.previousSibling; sib; sib = sib.previousSibling) {
            if (sib.localName === elm.localName) {
              i += 1;
            }
          }
          segs.unshift(`${elm.localName.toLowerCase()}[${i}]`);
        }
      }
      return segs.length ? `/${segs.join("/")}` : null;
    }
    // check element and all parents if they are visible
    static isVisible(el, window2) {
      if (!el) {
        return false;
      }
      if (el.nodeType === window2.Node.DOCUMENT_NODE) {
        return true;
      }
      if (el.nodeType === window2.Node.ELEMENT_NODE) {
        const s = window2.getComputedStyle(el);
        if (s.display.includes("none") || s.visibility.includes("hidden") || s.opacity === "0") {
          return false;
        }
        const rect = el.getBoundingClientRect();
        const elArea = rect.width * rect.height;
        let p = el.parentElement;
        while (p) {
          const pS = window2.getComputedStyle(p);
          if (pS.display.includes("none") || pS.visibility.includes("hidden") || pS.opacity === "0") {
            return false;
          }
          const pRect = p.getBoundingClientRect();
          if (pS.overflow === "hidden" && (pRect.height === 0 || pRect.width === 0)) {
            console.log("parent is hiding the element");
            console.log("parent", p);
            console.log("parent rect", pRect);
            console.log("element rect", rect);
            console.log("areas", "e", elArea, "p", pRect.width * pRect.height);
            return false;
          }
          p = p.parentElement;
        }
        return true;
      }
      return false;
    }
    static isUserVisible(el, window2) {
      if (!_DOM.isVisible(el, window2)) {
        return false;
      }
      const elStyles = window2.getComputedStyle(el);
      if (el.assignedSlot) {
        const slotVisible = _DOM.isUserVisible(el.assignedSlot.parentElement, window2);
        return slotVisible;
      } else if (elStyles.display !== "contents") {
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0 || [...el.children].filter((c) => !["BR", "SCRIPT", "STYLE"].includes(c.tagName)).length === 0 && (rect.width * rect.height === 0 || el.textContent.trim().replaceAll("\n", "").length === 0 && !["IMG", "VIDEO", "CANVAS", "SVG", "PICTURE", "EMBED"].includes(el.tagName) && !_DOM.hasBackgroundImage(el, window2))) {
          return false;
        }
      }
      return true;
    }
    // courtesy of https://github.com/adobecom/aem-milo-migrations/blob/main/tools/importer/parsers/utils.js
    static getNSiblingsSameTag(el, tag, document2, n = null) {
      let cmpFn = n;
      if (typeof n === "number") {
        cmpFn = (c) => c === n;
      }
      let selectedXpathPattern = "";
      const xpathGrouping = [];
      el.querySelectorAll(tag).forEach((d) => {
        const xpath = _DOM.getXPath(d, document2);
        const xp3 = xpath.substring(0, xpath.lastIndexOf("["));
        if (!xpathGrouping[xp3]) {
          xpathGrouping[xp3] = [d];
        } else {
          xpathGrouping[xp3].push(d);
        }
      });
      for (const key of Object.keys(xpathGrouping)) {
        if (cmpFn(xpathGrouping[key].length)) {
          selectedXpathPattern = key;
          break;
        }
      }
      return xpathGrouping[selectedXpathPattern] || null;
    }
    static getNSiblingsDivs(el, document2, n = null) {
      return _DOM.getNSiblingsSameTag(el, "div", document2, n);
    }
    static getNSiblingsSameLi(el, document2, n = null) {
      return _DOM.getNSiblingsSameTag(el, "li", document2, n);
    }
    static getPageSize(document2) {
      const htmlElement = document2.documentElement;
      const bodyElement = document2.body;
      const width = Math.max(
        htmlElement.clientWidth,
        htmlElement.scrollWidth,
        htmlElement.offsetWidth,
        bodyElement.scrollWidth,
        bodyElement.offsetWidth
      );
      const height = Math.max(
        htmlElement.clientHeight,
        htmlElement.scrollHeight,
        htmlElement.offsetHeight,
        bodyElement.scrollHeight,
        bodyElement.offsetHeight
      );
      return { width, height };
    }
    static getOffsetRect(el, window2) {
      const rect = el.getBoundingClientRect();
      const left = window2.document?.scrollingElement?.scrollLeft || 0;
      const top = window2.document?.scrollingElement?.scrollTop || 0;
      return {
        x: rect.left + left,
        y: rect.top + top,
        width: rect.width,
        height: rect.height
      };
    }
    static checkElStackUpCSSClasses(el, pattern) {
      let parent = el;
      while (parent) {
        if (parent.classList.contains(pattern)) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }
    static getAllVisibleElements = (window2, root = document.body) => {
      const types = [...root.querySelectorAll("*")].filter((el) => !["IFRAME", "NOSCRIPT", "BR", "EM", "STRONG", "STYLE", "SCRIPT"].includes(el.nodeName)).reduce((acc, currValue) => {
        const cl = currValue.closest("svg");
        if (!(cl !== null && cl !== currValue) && !acc.includes(currValue.nodeName) && /^[A-Z0-9-_]+$/.test(currValue.nodeName)) {
          acc.push(currValue.nodeName);
        }
        return acc;
      }, []);
      console.log("DOM node types:", types);
      const divs = [...root.querySelectorAll(types.join(","))].filter((el) => !el.closest("figure"));
      const visibleElements = divs.filter((e) => _DOM.isUserVisible(e, window2));
      console.log(`found ${visibleElements.length} visible elements in the page.`);
      return visibleElements;
    };
    static hasBackgroundImage(el, window2) {
      const elRect = el.getBoundingClientRect();
      const elArea = elRect.width * elRect.height;
      const bg = [el, ...el.querySelectorAll("*")].filter((c) => {
        const r = c.getBoundingClientRect();
        const a = r.width * r.height;
        return a >= elArea * 0.8;
      }).find((c) => {
        const s = window2.getComputedStyle(c);
        return s.backgroundImage && !s.backgroundImage.includes("none");
      });
      if (bg) {
        return true;
      }
      const images = [...el.querySelectorAll("img")].filter((i) => {
        const r = i.getBoundingClientRect();
        const a = r.width * r.height;
        return _DOM.isUserVisible(i, window2) && a >= elArea * 0.8;
      });
      if (images && images.length === 1) {
        return true;
      }
      return false;
    }
  };

  // src/utils/ui.js
  var UI_HTML = `
<html>
  <body>
    <template id="my-element">
      <style>
      .xp-ui-content {
        position: fixed;
        left: 50%;
        transform: translate(-50%, 0px);
        bottom: 55px;
        pointer-events: auto;
        z-index: 2147483640;
        width: auto;
        min-width: 640px;
        max-width: 900px;
        white-space: nowrap;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .075em;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .xp-ui-content ul {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        list-style-type: none;
        margin: 0;
        padding: 12px;
        border-radius: 12px;
        overflow: hidden;
        background-color: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(10px);
      }
      .xp-ui-content li {
        float: left;
        border-radius: 8px;
        color: white;
        display: block;
        text-align: center;
        padding: 8px 12px;
        text-decoration: none;
        background-color: #888;
        text-transform: uppercase;
      }
      .xp-ui-content li:hover {
        cursor: pointer;
        background-color: rgba(0, 0, 0, 0.75);
      }
      .xp-ui-content li.disabled {
        float: left;
        color: #555;
        display: block;
        text-align: center;
        padding: 8px 12px;
        text-decoration: none;
        background-color: rgba(0, 0, 0, 0.25);
      }
      .xp-ui-content li.disabled:hover {
        cursor: unset;
        // background-color: #111;
      }
      .xp-overlays {
        position:absolute;
        left:0;
        top:0;
        z-index:90000;
        display:none;
      }
      .xp-overlay:hover {
          background-color: rgba(0, 0, 144, .1);
      }
      .xp-overlay:hover .xp-overlay-label {
          display: block;
      }
      .xp-overlay.bottomRight:hover {
          background-color: rgba(0, 144, 0, .1);
      }
      .xp-overlay-label {
        display: block;
        position: absolute;
        left: 0px;
        top: 0px;
        background-color: rgba(0, 0, 144, 0.8);
        color: white;
        padding-left: 4px;
        font-family: Arial, sans-serif;
        font-size: 18px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;

        &.bottomRight {
          background-color: rgba(0, 144, 0, 0.8);
          left: unset;
          top: unset;
          right: 0px;
          bottom: 0px;
        }
      }
      </style>
      <ul>
        <li data-action="analyse" onclick="xp.ui.run(event);">Analyse</li>
        <li data-action="ignore-select" class="disabled" onclick="xp.ui.run(event);">Ignore Element</li>
        <li data-action="predict" class="disabled" onclick="xp.ui.run(event);">Predict</li>
        <li data-action="auto-detect-sections" onclick="xp.ui.run(event);">Auto Detect Sections</li>
        <li data-action="reduce-content" class="disabled" onclick="xp.ui.run(event);">Reduce Content</li>
        <li data-action="toggle-overlays" class="disabled" onclick="xp.ui.run(event);">Toggle Overlays</li>
      </ul>
    </template>
  </body>
</html>
`;
  function ready(fn) {
    if (document.readyState !== "loading") {
      fn();
      return;
    }
    document.addEventListener("DOMContentLoaded", fn);
  }
  var UI = class {
    constructor() {
      ready(() => {
        document.body.querySelector(".xp-ui")?.remove();
        const overlays = window.document.createElement("div");
        overlays.className = "xp-overlays";
        overlays.innerHTML = `<style>
      .xp-overlays {
        position:absolute;
        left:0;
        top:0;
        z-index:90000;
        display:none;
      }
      </style>`;
        const div = window.document.createElement("div");
        div.className = "xp-ui";
        document.body.append(div);
        const shadow = div.attachShadow({ mode: "open" });
        const divUI = window.document.createElement("div");
        divUI.className = "xp-ui-content";
        const parser = new DOMParser();
        const doc3 = parser.parseFromString(UI_HTML, "text/html");
        divUI.append(doc3.querySelector("template").content);
        shadow.append(divUI);
        shadow.append(overlays);
        const uiDiv = document.body.querySelector(".xp-ui");
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === "attributes") {
              if (mutation.target.dataset.status === "analysed") {
                [...document.body.querySelector(".xp-ui").shadowRoot.querySelectorAll("li")].forEach((li) => {
                  li.classList.remove("disabled");
                });
              }
            }
          });
        });
        observer.observe(uiDiv, {
          attributes: true
        });
      });
    }
    get div() {
      return document.querySelector(".xp-ui");
    }
    sidekickEl() {
      return document.querySelector(".xp-ui").shadowRoot.querySelector(".xp-ui-content");
    }
    overlaysDiv() {
      return document.querySelector(".xp-ui").shadowRoot.querySelector(".xp-overlays");
    }
    show() {
      if (this.div) this.div.style.display = "block";
    }
    hideSidekick() {
      if (this.div) {
        const uiEl = this.sidekickEl();
        if (uiEl) {
          uiEl.style.opacity = "0";
        }
      }
    }
    isVisible() {
      return this.div?.style.display === "block";
    }
    resetOverlays() {
      document.querySelector(".xp-ui").shadowRoot.querySelector(".xp-overlays").querySelectorAll("div").forEach((div) => div.remove());
    }
    toggleOverlays(show = null) {
      const d = document.querySelector(".xp-ui").shadowRoot.querySelector(".xp-overlays");
      if (show !== null) {
        d.style.display = show === true ? "block" : "none";
      } else {
        d.style.display = d.style.display === "block" ? "none" : "block";
      }
    }
    async run(event) {
      if (event.target.classList.contains("disabled")) {
        return;
      }
      const { action } = event.target.dataset;
      console.log("run", action);
      switch (action) {
        case "analyse":
          await xp.detectSections(document.body, window);
          this.div.dataset.status = "analysed";
          break;
        case "predict":
          xp.predictPage(window);
          break;
        case "ignore-select":
          xp.selectElementToIgnore();
          break;
        case "auto-detect-sections":
          await xp.detectSections(document.body, window, {
            autoDetect: true,
            highlightBoxes: true,
            highlightSections: true,
            debug: true
          });
          this.div.dataset.status = "analysed";
          break;
        case "ignore-element":
          const { boxId } = event.target.dataset;
          if (boxId) {
            xp.ignoreElementForDection(boxId);
          }
          break;
        case "toggle-overlays":
          xp.ui.toggleOverlays();
          break;
        case "reduce-content":
          xp.ui.resetOverlays();
          for (const box of xp.boxes.predictedBoxes) {
            await xp.reduceContent(box, document);
          }
          break;
      }
    }
  };

  // src/utils/flag.js
  var Flags = class {
    constructor(...flags) {
      flags.reduce((acc, flagName, index) => {
        acc[flagName] = 1 << index;
        return acc;
      }, this);
    }
  };
  var FlagSet = class {
    #flag = 0;
    constructor(...flags) {
      this.#flag = 0;
      this.setFlags(...flags);
    }
    get flag() {
      return this.#flag;
    }
    setFlags(...flags) {
      this.#flag = flags.reduce((acc, flag) => acc | flag, 0);
    }
    // Function to set a flag
    setFlag(flag) {
      this.#flag |= flag;
    }
    // Function to unset a flag
    unsetFlag(flag) {
      this.#flag &= ~flag;
    }
    // Function to check if a flag is set
    isFlagSet(flag) {
      return (this.#flag & flag) !== 0;
    }
    // Function to check if only the specified set of flags is set
    areOnlyFlagsSet(...flagValues) {
      const expectedFlags = flagValues.reduce((acc, flag) => acc | flag, 0);
      return this.#flag === expectedFlags;
    }
    getFlags(flagValues) {
      return Object.keys(flagValues).filter((flag) => this.isFlagSet(flagValues[flag]));
    }
  };

  // src/utils/utils.js
  function hashCode(s) {
    let h = 0;
    const l = s.length;
    let i = 0;
    if (l > 0) while (i < l) h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
  }
  function template(strings, ...keys) {
    return (...values) => {
      const dict = values[values.length - 1] || {};
      const result = [strings[0]];
      keys.forEach((key, i) => {
        const value = Number.isInteger(key) ? values[key] : dict[key];
        result.push(value, strings[i + 1]);
      });
      return result.join("");
    };
  }

  // src/utils/images.js
  async function generateImageBlob(document2, width, height, backgroundColor, text, options = {}) {
    const {
      textColor = "#ffffff",
      fontSize = Math.min(width, height) / 10,
      fontFamily = "Arial, sans-serif",
      fontWeight = "bold",
      textAlign = "left",
      textBaseline = "top",
      padding = 20,
      borderRadius = 0,
      borderWidth = 10,
      borderColor = "#0000FF",
      shadowColor = "rgba(0, 0, 0, 1)",
      shadowBlur = 1,
      shadowOffsetX = 2,
      shadowOffsetY = 2
    } = options;
    const canvas = document2.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    if (borderWidth > 0) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth);
    }
    if (borderRadius > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, borderRadius);
      ctx.clip();
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
      if (borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = textColor;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    if (shadowBlur > 0) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = shadowOffsetX;
      ctx.shadowOffsetY = shadowOffsetY;
    }
    const textX = 14;
    const textY = 14;
    const maxWidth = width - padding * 2;
    const words = text.split(" ");
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i];
      const { width: wordWidth } = ctx.measureText(`${currentLine} ${word}`);
      if (wordWidth < maxWidth) {
        currentLine += ` ${word}`;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    const lineHeight = fontSize * 1.2;
    const totalTextHeight = lines.length * lineHeight;
    const startY = textY - totalTextHeight / 2 + lineHeight / 2;
    lines.forEach((line, index) => {
      const y = startY + index * lineHeight;
      ctx.fillText(line, textX, y);
    });
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to generate image blob"));
          }
        }, "image/png", 1);
      } catch (e) {
        reject(e);
      }
    });
  }
  async function generateImageBlobWithUrl(document2, width, height, backgroundColor, text, options = {}) {
    const blob = await generateImageBlob(document2, width, height, backgroundColor, text, options);
    console.log("blob", blob);
    const url = URL.createObjectURL(blob);
    console.log("url", url);
    return { blob, url };
  }
  async function generateAndReplaceAllImages(document2, root, backgroundColor, text, options = {}) {
    const images = root.tagName === "IMG" ? [root] : root.querySelectorAll("img");
    let replacedCount = 0;
    for (const img of images) {
      const { url } = await generateImageBlobWithUrl(
        document2,
        img.width,
        img.height,
        backgroundColor,
        text,
        options
      );
      if (!img.hasAttribute("data-original-src")) {
        img.setAttribute("data-original-src", img.src);
      }
      img.src = url;
      if (img.parentElement.tagName === "PICTURE") {
        img.parentElement.replaceWith(img);
      }
      replacedCount += 1;
    }
    return replacedCount;
  }
  async function generateAndReplaceBackgroundImages(window2, document2, root, backgroundColor, text, options = {}) {
    try {
      const elements = [root, ...root.querySelectorAll("*")];
      let replacedCount = 0;
      for (const element of elements) {
        const style = window2.getComputedStyle(element);
        const { backgroundImage } = style;
        if (backgroundImage && backgroundImage !== "none") {
          if (!element.hasAttribute("data-original-background-image")) {
            element.setAttribute("data-original-background-image", backgroundImage);
          }
          const { url } = await generateImageBlobWithUrl(
            document2,
            element.width,
            element.height,
            backgroundColor,
            text,
            options
          );
          element.style.backgroundImage = `url(${url})`;
          replacedCount += 1;
        }
      }
      return replacedCount;
    } catch (e) {
      console.error("Error generating and replacing background images", e);
      return 0;
    }
  }

  // src/utils/reduce.js
  async function reduceContent(root, document2) {
    console.log("root", root);
    console.log("document", document2);
    try {
      await generateAndReplaceAllImages(document2, root, "cyan", "dummy image".toUpperCase());
      await generateAndReplaceBackgroundImages(document2.defaultView, document2, root, "cyan", "dummy image".toUpperCase());
    } catch (e) {
      console.error("Error generating and replacing images", e);
    }
    try {
      const videos = root.tagName === "VIDEO" ? [root] : root.querySelectorAll("video");
      for (const video of videos) {
        const vRect = video.getBoundingClientRect();
        const { url } = await generateImageBlobWithUrl(document2, vRect.width, vRect.height, "cyan", "video poster".toUpperCase());
        const imgEl = document2.createElement("img");
        imgEl.src = url;
        imgEl.width = vRect.width;
        imgEl.height = vRect.height;
        video.replaceWith(imgEl);
      }
    } catch (e) {
      console.error("Error replacing videos with images", e);
    }
    const elements = root.querySelectorAll("div:has(> div)");
    for (const el of elements) {
      let divs = el.querySelectorAll(":scope > div");
      const firstDiv = divs[0];
      const classList = Array.from(firstDiv.classList);
      const filteredClassList = classList.filter((className) => /^[a-zA-Z0-9\-_]+$/.test(className));
      const firstDivClassList = filteredClassList.join(".");
      if (el.querySelectorAll(`:scope > div${firstDivClassList !== "" ? `.${firstDivClassList}` : ""}`).length === divs.length && divs.length > 3) {
        while (true) {
          divs = el.querySelectorAll(":scope > div");
          if (divs.length <= 3) break;
          divs[divs.length - 1].remove();
        }
      }
    }
    console.log("elements with more than 3 div children", elements);
    const lists = root.tagName === "UL" || root.tagName === "OL" ? [root] : root.querySelectorAll("ul, ol");
    for (const list of lists) {
      while (list.children.length > 3) {
        list.removeChild(list.lastChild);
      }
    }
    const tables = root.tagName === "TABLE" ? [root] : root.querySelectorAll("table");
    for (const table of tables) {
      while (table.querySelectorAll(":scope *:not(thead) > tr").length > 3) {
        table.querySelector(":scope *:not(thead) > tr:last-child").remove();
      }
    }
    if (root.closest) {
      const table = root.tagName === "TABLE" ? root : root.closest("table");
      if (table) {
        while (table.querySelectorAll(":scope *:not(thead) > tr").length > 3) {
          table.querySelector(":scope *:not(thead) > tr:last-child").remove();
        }
      }
    }
    const paragraphs = root.tagName === "P" ? [root] : root.querySelectorAll("p");
    for (const el of paragraphs) {
      if (el.children.length === 0 && el.textContent.replaceAll(" ", "").replaceAll("\n", "").replaceAll("	", "").replaceAll("&nbsp;", "").trim().length === 0) {
        el.remove();
      }
    }
    const n3 = DOM.getNSiblingsSameTag(root, "p", document2, (i) => i > 3);
    console.log("n p", n3);
    if (n3) {
      const parent = n3[0].parentElement;
      while (parent.children.length > 3) {
        parent.removeChild(parent.lastChild);
      }
    }
    const ttreeWalker = document2.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      (node) => (
        // exclude script and style nodes
        node.closest("script, style") ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT
      )
    );
    let cNode = ttreeWalker.currentNode;
    while (cNode) {
      for (const node of cNode.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.data.replaceAll(" ", "").replaceAll("\n", "").trim() && node.data !== "{TEXT}") {
          if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(cNode.tagName)) {
            node.data = "{HEADING}";
          } else {
            node.data = "{TEXT}";
          }
        }
      }
      cNode = ttreeWalker.nextNode();
    }
    const forms = root.tagName === "FORM" ? [root] : root.querySelectorAll("form");
    console.log("forms", forms);
    forms.forEach((form) => {
      console.log("form", form);
      form.innerHTML = "<form><h2>{FORM}</h2></form>";
    });
    const stylingTags = ["b", "u", "s", "strong", "em"];
    while (root.querySelector(stylingTags.join(", "))) {
      const el = root.querySelector(stylingTags.join(", "));
      const parent = el.parentElement;
      parent.replaceChild(document2.createTextNode(el.textContent), el);
    }
    const paragraphs2 = root.tagName === "P" ? [root] : root.querySelectorAll("p");
    for (const el of paragraphs2) {
      if (el.childNodes.length > 1) {
        el.replaceChildren(el.firstChild);
      }
    }
  }
  function findShadowRoots(ele) {
    return [
      ele,
      ...ele.querySelectorAll("*")
    ].filter((e) => !!e.shadowRoot).flatMap((e) => [e.shadowRoot, ...findShadowRoots(e.shadowRoot)]);
  }

  // src/utils/dom/step.js
  var Step = class {
    value;
    optimized;
    constructor(value, optimized) {
      this.value = value;
      this.optimized = optimized || false;
    }
    toString() {
      return this.value;
    }
  };

  // src/utils/dom/xpath.js
  function xPathIndex(node) {
    function areNodesSimilar(left, right) {
      if (left === right) {
        return true;
      }
      if (left.nodeType === Node.ELEMENT_NODE && right.nodeType === Node.ELEMENT_NODE) {
        return left.nodeName === right.nodeName;
      }
      if (left.nodeType === right.nodeType) {
        return true;
      }
      const leftType = left.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : left.nodeType;
      const rightType = right.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : right.nodeType;
      return leftType === rightType;
    }
    const siblings = node.parentElement ? node.parentElement.children : null;
    if (!siblings) {
      return 0;
    }
    let hasSameNamedElements;
    for (let i = 0; i < siblings.length; ++i) {
      if (areNodesSimilar(node, siblings[i]) && siblings[i] !== node) {
        hasSameNamedElements = true;
        break;
      }
    }
    if (!hasSameNamedElements) {
      return 0;
    }
    let ownIndex = 1;
    for (let i = 0; i < siblings.length; ++i) {
      if (areNodesSimilar(node, siblings[i])) {
        if (siblings[i] === node) {
          return ownIndex;
        }
        ++ownIndex;
      }
    }
    return -1;
  }
  function xPathValue(node, optimized) {
    let ownValue;
    const ownIndex = xPathIndex(node);
    if (ownIndex === -1) {
      return null;
    }
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        if (optimized && node.getAttribute("id")) {
          return new Step(`//*[@id="${node.getAttribute("id")}"]`, true);
        }
        ownValue = node.nodeName.toLowerCase();
        break;
      case Node.ATTRIBUTE_NODE:
        ownValue = `@${node.nodeName.toLowerCase()}`;
        break;
      case Node.TEXT_NODE:
      case Node.CDATA_SECTION_NODE:
        ownValue = "text()";
        break;
      case Node.PROCESSING_INSTRUCTION_NODE:
        ownValue = "processing-instruction()";
        break;
      case Node.COMMENT_NODE:
        ownValue = "comment()";
        break;
      case Node.DOCUMENT_NODE:
        ownValue = "";
        break;
      default:
        ownValue = "";
        break;
    }
    if (ownIndex > 0) {
      ownValue += `[${ownIndex}]`;
    }
    return new Step(ownValue, node.nodeType === Node.DOCUMENT_NODE);
  }
  var XPath = class {
    static getRelativeXPath(node, optimized) {
      if (node.nodeType === Node.DOCUMENT_NODE) {
        return "/";
      }
      const steps = [];
      let contextNode = node || null;
      while (contextNode) {
        const step = xPathValue(contextNode, optimized);
        if (!step) {
          break;
        }
        steps.push(step);
        if (step.optimized) {
          break;
        }
        contextNode = contextNode.parentNode;
      }
      steps.reverse();
      return (steps.length && steps[0].optimized ? "" : "/") + steps.join("/");
    }
  };

  // src/utils/browser.js
  function extractBackground(el, window2) {
    let bg = null;
    bg = [el, ...el.querySelectorAll("*")].find((child) => {
      const s = window2.getComputedStyle(child);
      const cssBGImage = s.backgroundImage || "none";
      let cssBGColor = (
        /* s.backgroundColor || */
        "none"
      );
      if (cssBGColor && cssBGColor.includes("rgba")) {
        const c = Color.fromRGBA(cssBGColor);
        if (c.a === 0) {
          cssBGColor = "none";
        }
      }
      if (cssBGImage.includes("none") && cssBGColor.includes("none")) {
        return false;
      } else if (cssBGImage || cssBGColor) {
        return true;
      }
      return false;
    });
    if (bg) {
      return bg;
    }
    const elr = el.getBoundingClientRect();
    const elArea = elr.width * elr.height;
    const images = [...el.querySelectorAll("img")].filter((e) => DOM.isUserVisible(e, window2));
    if (images && images.length === 1) {
      bg = images.shift();
      const bgr = bg.getBoundingClientRect();
      const bgArea = bgr.width * bgr.height;
      if (bgArea >= elArea * 0.8) {
        return bg;
      }
    }
    return null;
  }

  // src/utils/predictions/video-embeds.js
  var videoSources = [
    "youtube.com",
    "vimeo.com",
    "dailymotion.com",
    "wistia.com",
    "twitch.tv",
    "facebook.com",
    "vidyard.com",
    "jwplayer.com",
    "brightcove.com",
    "kaltura.com",
    "streamable.com",
    "video.ibm.com",
    "youku.com",
    "metacafe.com",
    "vevo.com",
    "rutube.ru",
    "vzaar.com",
    "sproutvideo.com",
    "viddler.com",
    "vid.me",
    "bitmovin.com",
    "panopto.com",
    "media.ccc.de",
    "bitchute.com",
    "rumble.com",
    "peer.tube",
    "d.tube",
    "lbry.tv",
    "odysee.com",
    "archive.org",
    "ted.com",
    "cnn.com",
    "bbc.com",
    "nbcnews.com",
    "foxnews.com",
    "cbsnews.com",
    "abcnews.go.com",
    "reuters.com",
    "bloomberg.com",
    "nytimes.com",
    "washingtonpost.com",
    "guardian.co.uk",
    "forbes.com",
    "wsj.com",
    "usatoday.com",
    "hulu.com",
    "netflix.com",
    "primevideo.com",
    "disneyplus.com",
    "hbomax.com",
    "peacocktv.com",
    "paramountplus.com",
    "apple.com",
    "crunchyroll.com",
    "funimation.com",
    "anime-planet.com",
    "myanimelist.net",
    "9anime.to",
    "gogoanime.io",
    "kissanime.ru",
    "animefreak.tv",
    "animedao.com",
    "animeheaven.ru",
    "anilinkz.to",
    "chia-anime.me",
    "animeultima.eu",
    "animepahe.com",
    "animixplay.to",
    "animekisa.tv",
    "animehub.ac",
    "animeowl.net",
    "animevibe.tv",
    "animeflv.net",
    "animeid.tv",
    "animeyt.tv",
    "animefenix.com",
    "animeblix.com",
    "animeflv.net",
    "animeid.tv",
    "animeyt.tv",
    "animefenix.com",
    "animeblix.com",
    "animeflv.net",
    "animeid.tv",
    "animeyt.tv",
    "animefenix.com",
    "animeblix.com",
    "animeflv.net",
    "animeid.tv",
    "animeyt.tv",
    "animefenix.com",
    "animeblix.com"
  ];
  var videoExtensions = [
    "mp4",
    "webm",
    "ogg",
    "mov",
    "avi"
  ];
  function isVideoEmbed(el) {
    const src = el.src || el.querySelector("[src]")?.src;
    console.log("isVideoEmbed src", el, src);
    return src && videoSources.some((domain) => src.includes(domain) || videoExtensions.some((ext) => src.endsWith(`.${ext}`)));
  }
  function containsVideoEmbeds(el) {
    const elements = [...el.querySelectorAll("iframe, embed, object, video")];
    return elements.some(isVideoEmbed);
  }

  // src/utils/styles.js
  function getStylesIframe(window2) {
    const { document: document2 } = window2;
    const blankIframe = document2.createElement("iframe");
    blankIframe.classList.add("blu-det-default-styles-iframe");
    document2.body.appendChild(blankIframe);
    return blankIframe;
  }
  var stylesCache = /* @__PURE__ */ new Map();
  function getDefaultCSSPropertiesForElement(el, window2, properties) {
    if (stylesCache.has(el.tagName)) {
      return stylesCache.get(el.tagName);
    }
    const iframe = getStylesIframe(window2);
    const iframeDocument = iframe.contentDocument;
    const targetElement = iframeDocument.createElement(el.tagName);
    iframeDocument.body.appendChild(targetElement);
    const pS = iframe.contentWindow.getComputedStyle(targetElement);
    const values = properties.map((property) => pS[property]);
    iframeDocument.body.removeChild(targetElement);
    iframe.remove();
    stylesCache.set(el.tagName, values);
    return values;
  }

  // src/utils/sections.js
  var SECTION_FEATURES = new Flags(
    "isFromRootBox",
    "hasHeader",
    "hasTexts",
    "hasBackground",
    "hasBackgroundImage",
    "hasHeading",
    "hasCTA",
    "hasImages",
    "hasMultipleColumns",
    "hasMultipleRows",
    "hasComplexHiddenElements",
    "isGridLayout",
    "isInsideAHeaderLikeElement",
    "isInsideAFooterLikeElement",
    "containsVideoEmbed"
    // 'hasForms',
    // 'hasTables',
    // 'hasLists',
  );
  var SectionPrediction = class {
    constructor({
      sectionType,
      sectionFeatures,
      tpl,
      confidence
    }) {
      this.sectionType = sectionType;
      this.sectionFeatures = sectionFeatures;
      this.template = tpl;
      this.confidence = confidence;
    }
  };
  var SECTION_TYPES = [
    {
      name: "container",
      predictFn: ({
        box
      }) => box.div.classList.contains("blu-det-container")
    },
    {
      name: "table",
      predictFn: ({
        box
      }) => box.div.tagName === "TABLE"
    },
    {
      name: "form",
      predictFn: ({
        box
      }) => box.div.tagName === "FORM"
    },
    {
      name: "carousel",
      predictFn: ({
        box,
        window: window2
      }) => {
        try {
          console.group(">>> carousel");
          console.log(box.div);
          if (box.div.classList.contains("carousel")) {
            return true;
          }
          const sibEls = DOM.getNSiblingsDivs(box.div, window2.document, (n) => n > 2);
          if (sibEls) {
            console.log("predict carousel");
            console.log(sibEls);
            const sameEls = {};
            sibEls.forEach((el) => {
              const elXPath = DOM.getXPath(el, window2.document);
              const xpaths = [...el.querySelectorAll("div")].map((el2) => DOM.getXPath(el2, window2.document).slice(elXPath.length));
              console.log(xpaths);
              const hash = hashCode(xpaths.join("\n"));
              console.log(hash);
              if (sameEls[hash]) {
                sameEls[hash].push(el);
              } else {
                sameEls[hash] = [el];
              }
            });
            console.log("sameEls", sameEls);
            const key = Object.keys(sameEls).filter((k) => sameEls[k].length > 1);
            console.log("key", key);
            if (sameEls[key]) {
              let hasVisibleElements = false;
              let hasHiddenElements = false;
              sameEls[key].forEach((el) => {
                const rect = el.getBoundingClientRect();
                const elStyles = window2.getComputedStyle(el);
                console.log("check is visible or not ---");
                console.log(rect);
                console.log(DOM.isVisible(el, window2));
                console.log(rect.x + rect.width, window2.innerWidth);
                console.log(elStyles.width, elStyles.height);
                console.log("---");
                if ((rect.width > 0 && rect.height > 0 || (elStyles.width === "auto" || elStyles.height === "auto")) && (!DOM.isVisible(el, window2) || rect.x + rect.width > window2.innerWidth)) {
                  hasHiddenElements = true;
                } else {
                  hasVisibleElements = true;
                }
              });
              console.log("is", box.div, "a carousel?", hasVisibleElements, hasHiddenElements);
              if (hasVisibleElements && hasHiddenElements) {
                console.log(box.div, "is a carousel:", hasVisibleElements && hasHiddenElements);
                return true;
              }
            }
            console.log("is not a carousel");
            return false;
          }
          console.log("no siblings, not a carousel");
          return false;
        } finally {
          console.groupEnd();
        }
      }
    },
    {
      name: "cards",
      predictFn: ({
        box,
        features
      }) => {
        console.groupCollapsed(">>> cards");
        console.log(box.div);
        console.log(box.div.classList);
        console.log(box);
        console.log(box.children.every((child) => DOM.checkElStackUpCSSClasses(child.div, "card")));
        console.log(DOM.checkElStackUpCSSClasses(box.div, "card"));
        console.log(features.isFlagSet(SECTION_FEATURES.isGridLayout));
        const aaa = features.isFlagSet(SECTION_FEATURES.isGridLayout) && (box.div.classList.value.includes("card") || box.children.find((child) => child.div.querySelector('[class*="card"]') !== null) !== void 0);
        console.log("aaa", aaa);
        console.groupEnd();
        return aaa;
      }
    },
    {
      name: "columns",
      predictFn: ({
        features
      }) => {
        console.log("flags", features.getFlags(SECTION_FEATURES));
        return features.isFlagSet(SECTION_FEATURES.isGridLayout);
      }
    },
    {
      name: "hero",
      predictFn: ({
        box,
        features,
        window: window2
      }) => box.height <= window2.innerHeight && (features.isFlagSet(SECTION_FEATURES.hasBackgroundImage) && features.isFlagSet(SECTION_FEATURES.hasHeading) || box.children.length === 2 && box.children.some((c) => c.prediction?.sectionFeatures.includes("hasBackgroundImage")) && box.children.some((c) => c.prediction?.sectionFeatures.includes("hasHeading")))
    },
    {
      name: "default-content",
      predictFn: ({
        box,
        features
      }) => {
        if (features.isFlagSet(SECTION_FEATURES.hasComplexHiddenElements)) {
          return false;
        }
        if (["PRE", "P"].includes(box.div.tagName)) {
          return true;
        }
        let onlyIcons = true;
        const testImages = [...box.div.querySelectorAll("img")].some((img) => {
          const rect = img.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 50) {
            return true;
          }
          return false;
        });
        if (testImages) {
          onlyIcons = false;
        }
        const childrenOnlyTextLike = !box.children?.some((child) => {
          console.log(child.prediction?.sectionType);
          if (!["heading", "text", "text+icons"].includes(child.prediction?.sectionType)) {
            return true;
          }
          return false;
        });
        console.log("childrenOnlyTextLike", box, childrenOnlyTextLike, features);
        return childrenOnlyTextLike && (features.isFlagSet(SECTION_FEATURES.hasTexts) && !features.isFlagSet(SECTION_FEATURES.hasBackground) || features.isFlagSet(SECTION_FEATURES.hasImages) && !features.isFlagSet(SECTION_FEATURES.hasBackground) || features.isFlagSet(SECTION_FEATURES.hasTexts) && features.isFlagSet(SECTION_FEATURES.hasImages) && !features.isFlagSet(SECTION_FEATURES.hasBackground) || !features.isFlagSet(SECTION_FEATURES.isGridLayout) && features.isFlagSet(SECTION_FEATURES.hasTexts) && onlyIcons && !features.isFlagSet(SECTION_FEATURES.hasBackground) || features.areOnlyFlagsSet(
          SECTION_FEATURES.hasImages,
          SECTION_FEATURES.hasBackground,
          SECTION_FEATURES.hasBackgroundImage
        ));
      }
    }
  ];
  function elementHasStyledBackground(el, window2) {
    const pS = window2.getComputedStyle(el);
    const [defaultBgColor, defaultBgImage] = getDefaultCSSPropertiesForElement(el, window2, ["backgroundColor", "backgroundImage"]);
    return defaultBgColor !== pS.backgroundColor || defaultBgImage !== pS.backgroundImage;
  }
  function closestStyledSectionAncestor(el, window2, backgroundToSkip = null) {
    let p = el;
    while (p && p.nodeName !== "BODY") {
      if (elementHasStyledBackground(p, window2) && (!backgroundToSkip || backgroundToSkip !== window2.getComputedStyle(p).background)) {
        return p;
      }
      p = p.parentElement;
    }
    return null;
  }
  function findStyledSectionChildren(el, window2, backgroundToSkip = null) {
    const children = [...el.children];
    const parentRect = el.getBoundingClientRect();
    for (const child of children) {
      const childRect = child.getBoundingClientRect();
      if (childRect.width !== parentRect.width || childRect.height !== parentRect.height) {
        break;
      }
      if (elementHasStyledBackground(child, window2) && (!backgroundToSkip || backgroundToSkip !== window2.getComputedStyle(child).background)) {
        return child;
      }
      const result = findStyledSectionChildren(child, window2, backgroundToSkip);
      if (result) {
        return result;
      }
    }
    return null;
  }
  function elementHasCTALink(el, window2) {
    const defaultAEl = window2.document.createElement("a");
    document.body.appendChild(defaultAEl);
    const defaultAElStyles = window2.getComputedStyle(defaultAEl);
    const found = [...el.querySelectorAll("a")].find((a) => {
      const hasBackground = ["background", "background-color", "background-image"].find((prop) => {
        const s = window2.getComputedStyle(a);
        console.log(prop, s[prop], defaultAElStyles[prop]);
        return s[prop] !== defaultAElStyles[prop];
      });
      if (hasBackground) {
        console.log("hasBackground");
        return true;
      }
      let bordersNum = 0;
      ["left", "right", "top", "bottom"].forEach((side) => {
        const borderStyle = window2.getComputedStyle(a).getPropertyValue(`border-${side}-style`);
        console.log(side, borderStyle, defaultAElStyles[`border-${side}-style`]);
        if (borderStyle !== defaultAElStyles[`border-${side}-style`]) {
          bordersNum += 1;
        }
      });
      if (bordersNum > 1) {
        console.log("bordersNum");
        return true;
      }
      return false;
    });
    return found !== void 0;
  }
  function predictSection(box, idx, boxes, window2, isRootBox = true) {
    if (box.ignored) {
      return null;
    }
    console.log("predictSection:", boxes?.length);
    let sectionType = "unknown";
    const sectionFeatures = new FlagSet();
    const el = box.div;
    if (isRootBox) {
      sectionFeatures.setFlag(SECTION_FEATURES.isFromRootBox);
    }
    if (el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("script, style, link, meta, noscript").forEach((el2) => el2.remove());
      const hasTexts = clone.textContent.replaceAll(" ", "").replaceAll("\n", "").trim().length > 0;
      if (hasTexts) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasTexts);
      }
      const hasImages = [...el.querySelectorAll("img, picture, svg")].some((el2) => DOM.isUserVisible(el2, window2));
      if (["IMG", "PICTURE", "SVG"].includes(el.nodeName) || hasImages) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasImages);
      }
      const hasBackground = !!extractBackground(box.div, window2);
      if (hasBackground) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasBackground);
      }
      if (box.div && box.div.nodeName === "IMG" || DOM.hasBackgroundImage(box.div, window2)) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasBackgroundImage);
      }
      const hasHeading = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")].length > 0 || ["H1", "H2", "H3", "H4", "H5", "H6"].includes(el.nodeName);
      if (hasHeading) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasHeading);
      }
      const hasCTA = elementHasCTALink(el, window2);
      if (hasCTA) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasCTA);
      }
      const hasComplexHiddenElements = [el, ...el.querySelectorAll("*")].some((el2) => !DOM.isUserVisible(el2, window2) && el2.children.length > 0 && el2.textContent.replaceAll(" ", "").replaceAll("\n", "").trim().length > 0);
      if (hasComplexHiddenElements) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasComplexHiddenElements);
      }
      const layout = box.determineLayout();
      if (layout.numRows > 1) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasMultipleRows);
      }
      if (layout.numCols > 1) {
        sectionFeatures.setFlag(SECTION_FEATURES.hasMultipleColumns);
      }
      if (layout.numCols > 1) {
        sectionFeatures.setFlag(SECTION_FEATURES.isGridLayout);
      }
      if (el.closest("header, .header, #header") || DOM.checkElStackUpCSSClasses(el, "header") || box.x === 0 && box.y === 0) {
        sectionFeatures.setFlag(SECTION_FEATURES.isInsideAHeaderLikeElement);
      }
      if (el.closest("footer, .footer, #footer") || DOM.checkElStackUpCSSClasses(el, "footer")) {
        sectionFeatures.setFlag(SECTION_FEATURES.isInsideAFooterLikeElement);
      }
      console.log("containsVideoEmbeds", el);
      if (containsVideoEmbeds(el)) {
        sectionFeatures.setFlag(SECTION_FEATURES.containsVideoEmbed);
      }
    }
    const { children } = box;
    children.forEach((...args) => {
      predictSection(...args, window2, false);
    });
    if (!isRootBox) {
      if (children.filter((child) => ["carousel", "container"].includes(child.prediction.sectionType)).length === 0) {
        const prediction = SECTION_TYPES.find((st) => st.predictFn({
          box,
          idx,
          boxes: null,
          features: sectionFeatures,
          window: window2
        }));
        if (prediction) {
          sectionType = prediction.name;
        }
      } else {
        sectionType = "container";
      }
    }
    if (!box.div?.classList.contains("blu-det-container") && ["unknown", "container"].includes(sectionType) && box.children.length > 0 && box.children.every((child) => child.prediction.sectionType === "default-content")) {
      sectionType = "default-content";
    }
    box.prediction = new SectionPrediction({
      sectionType,
      sectionFeatures: sectionFeatures.getFlags(SECTION_FEATURES),
      confidence: -1
    });
    console.group("prediction");
    console.log("prediction");
    console.log(sectionFeatures.getFlags(SECTION_FEATURES));
    console.log(el);
    console.log("section prediction:", box.prediction);
    console.groupEnd();
    return box.prediction;
  }

  // src/utils/post-processors.js
  function findCommonAncestor(box1, box2, document2) {
    const el1 = box1.div;
    const el2 = box2.div;
    const ancestors1 = [];
    let current = el1;
    while (current && current !== document2) {
      ancestors1.push(current);
      current = current.parentElement;
    }
    current = el2;
    while (current && current !== document2) {
      if (ancestors1.includes(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return document2.body;
  }
  function identifyTabs(boxes, document2, window2) {
    console.groupCollapsed(">>> tabs post-processor");
    try {
      const shortColumnsBoxes = boxes.filter((box) => box.prediction.sectionType === "columns" && box.height < 100);
      for (const shortColumnsBox of shortColumnsBoxes) {
        const indexInBoxesArray = boxes.indexOf(shortColumnsBox);
        if (indexInBoxesArray === 0 || indexInBoxesArray === indexInBoxesArray.length - 1) {
          continue;
        }
        console.log("shortColumnsBox found:", shortColumnsBox, "index:", indexInBoxesArray);
        const tabContentIndex = indexInBoxesArray + 1;
        if (tabContentIndex < boxes.length) {
          const nextBox = boxes[tabContentIndex];
          console.log("nextBox, after the shortColumnsBox:", nextBox);
          if (nextBox.prediction.sectionFeatures.includes("hasComplexHiddenElements")) {
            const tabListBox = shortColumnsBox;
            const tabContentBox = nextBox;
            console.log("tabs element found: tabListBox", tabListBox, "tabContentBox", tabContentBox);
            const commonAncestor = findCommonAncestor(tabListBox, tabContentBox, document2);
            console.log("tabs list and content commonAncestor", commonAncestor);
            const hasOtherBoxInAncestor = boxes.filter((box) => box !== tabListBox && box !== tabContentBox).find((box) => box.xpath.startsWith(commonAncestor.xpath)) !== void 0;
            console.log("Is there another box in this commonAncestor?", hasOtherBoxInAncestor);
            if (!hasOtherBoxInAncestor) {
              console.log("Tabs combination found: Replacing both boxes with a tabs box");
              const tabBox = Box.fromDiv(commonAncestor, window2);
              tabBox.xpath = DOM.getXPath(commonAncestor, document2);
              tabBox.xpathWithDetails = XPath.getRelativeXPath(commonAncestor, true);
              tabBox.id = `box-id-${hashCode(tabBox.xpath)}`;
              boxes.splice(tabContentIndex, 1);
              boxes.splice(indexInBoxesArray, 1, tabBox);
              predictSection(tabBox, indexInBoxesArray, boxes, window2);
            } else {
              console.warn("One or more boxes are present in the shared ancestor of the tabs element, skipping.");
            }
          }
        }
      }
    } catch (error) {
      console.error("Error identifying tabs:", error);
    } finally {
      console.groupEnd();
    }
    return boxes;
  }

  // src/detect.js
  var xp2 = window.xp ?? {};
  var DEFAULT_COLORS = [
    new Color({
      name: "violet",
      r: 148,
      g: 0,
      b: 211
    }),
    new Color({
      name: "indigo",
      r: 75,
      g: 0,
      b: 130
    }),
    new Color({
      name: "blue",
      r: 0,
      g: 0,
      b: 255
    }),
    new Color({
      name: "green",
      r: 0,
      g: 255,
      b: 0
    }),
    new Color({
      name: "yellow",
      r: 255,
      g: 255,
      b: 0
    }),
    new Color({
      name: "orange",
      r: 255,
      g: 127,
      b: 0
    }),
    new Color({
      name: "red",
      r: 255,
      g: 0,
      b: 0
    })
  ];
  xp2.DOM = DOM;
  xp2.XPath = XPath;
  xp2.Flags = Flags;
  xp2.FlagSet = FlagSet;
  xp2.filterDivs = (divs) => {
    const { width, height } = DOM.getPageSize();
    console.log("page size:", width, height);
    const d = divs.filter((div) => {
      const rect = div.getBoundingClientRect();
      console.log(div, 0.8 * width * height, rect.width * rect.height);
      return !div.classList.contains("xp-ui") && !div.closest(".xp-ui") && (rect.width !== 0 && rect.height !== 0) && rect.width * rect.height > 5e3 && rect.width * rect.height < 0.8 * width * height && DOM.isVisible(div, window) && div.closest("figure") === null;
    });
    console.log(d.length);
    console.log(d.map((div) => div));
    const d2 = d.filter((div) => {
      let parent = div.parentElement;
      while (parent) {
        const dRect = div.getBoundingClientRect();
        const pRect = parent.getBoundingClientRect();
        if (pRect.width === 0 || pRect.height === 0) {
          if (parent.style.overflow === "hidden") {
            return false;
          }
          parent = parent.parentElement;
        } else {
          if (dRect.width >= 0.9 * pRect.width && dRect.height >= 0.9 * pRect.height) {
            return false;
          }
          parent = parent.parentElement;
        }
      }
      return true;
    });
    console.log(d2.length);
    console.log(d2.map((div) => div));
    return d2;
  };
  var HIGHLIGHT_DIV_STYLE_TPL = template`position:absolute;z-index:10000000;left:${0}px;top:${1}px;width:${2}px;height:${3}px;border:${5}px ${6} ${4};`;
  var highlightBox = (box, {
    // options
    window: window2,
    target = document.body,
    padding = 0,
    color = null,
    label = null,
    extraClass = null
  }) => {
    if (!box.div) {
      console.warn("dom element not defined for box, cannot highlight", box);
      return;
    }
    let uiTarget = target;
    const c = color || "rgba(0, 0, 144, 1)";
    const rect = DOM.getOffsetRect(box.div, window2);
    const d = document.createElement("div");
    d.dataset.boxId = box.id;
    d.dataset.boxXpath = box.xpath;
    d.dataset.boxXpathWithDetails = box.xpathWithDetails;
    d.dataset.layout = JSON.stringify(box.layout);
    const boxData = (({
      id,
      x,
      y,
      width,
      height,
      xpath,
      layout
    }) => ({
      id,
      x,
      y,
      width,
      height,
      xpath,
      layout
    }))(box);
    d.dataset.boxData = JSON.stringify(boxData);
    d.className = "xp-overlay";
    const borderWidth = 2;
    d.style = HIGHLIGHT_DIV_STYLE_TPL(
      rect.x + padding,
      rect.y + padding,
      // - topOffset,
      rect.width - padding * 2 - borderWidth * 2,
      rect.height - padding * 2 - borderWidth * 2,
      c,
      borderWidth,
      !extraClass ? "solid" : "dashed"
    );
    if (label) {
      const l = window2.document.createElement("div");
      l.className = "xp-overlay-label";
      l.textContent = label;
      if (extraClass) {
        l.classList.add(extraClass);
      }
      d.appendChild(l);
    }
    if (true) {
      uiTarget = xp2.ui.overlaysDiv();
    }
    uiTarget.appendChild(d);
  };
  function highlightAllBoxes(boxes, window2, padding = 0, colors = DEFAULT_COLORS, color = null, colorLevel = 0) {
    boxes.forEach((box, idx) => {
      const c = color || colors[idx % (colors.length - 1)];
      const alpha = colorLevel === 0 ? 1 : Math.max(0.1, 0.5 - colorLevel * 0.1);
      const boxColor = c.withAlpha(alpha).toRGBA();
      box.color = boxColor;
      highlightBox(box, {
        window: window2,
        target: window2.document.body,
        padding,
        color: boxColor,
        label: `layout: ${box.layout.numCols}x${box.layout.numRows}`
      });
      if (box.children.length > 0) {
        highlightAllBoxes(box.children, window2, padding + 4, colors, c, colorLevel + 1);
      }
    });
  }
  function getAllVisibleDivs() {
    const types = [...document.body.querySelectorAll("*")].filter((el) => !["IFRAME", "NOSCRIPT", "BR", "EM", "STRONG", "STYLE", "SCRIPT"].includes(el.nodeName)).reduce((acc, currValue) => {
      const cl = currValue.closest("svg");
      if (!(cl !== null && cl !== currValue) && !acc.includes(currValue.nodeName)) {
        acc.push(currValue.nodeName);
      }
      return acc;
    }, []);
    console.log("DOM node types:", types);
    const divs = [...document.querySelectorAll(types.join(","))];
    const visibleDivs = xp2.filterDivs(divs);
    console.log(`found ${visibleDivs.length} visible divs to show!`);
    return visibleDivs;
  }
  xp2.getAllVisibleDivs = getAllVisibleDivs;
  xp2.buildBoxTree = (divs, window2) => {
    const root = new Box(0, 0, window2.innerWidth, window2.document.scrollingElement.scrollHeight);
    const boxes = divs.map((d) => Box.fromDiv(d, window2));
    function builBoxesdHierarchy(parent, children, usedIndices) {
      children.forEach((child, index) => {
        if (usedIndices.has(index)) {
          return;
        }
        const ccc = parent.contains(child, false);
        if (ccc) {
          const newParent = child;
          parent.addChild(newParent);
          usedIndices.add(index);
          builBoxesdHierarchy(newParent, children, usedIndices);
        }
      });
    }
    builBoxesdHierarchy(root, boxes, /* @__PURE__ */ new Set());
    function computeLayout(box) {
      box.determineLayout();
      box.children.forEach(computeLayout);
    }
    computeLayout(root);
    function flattenHierarchy(box) {
      if (box.children.length === 1 && box.layout.numCols === 1) {
        const child = box.children[0];
        box.children = child.children;
        flattenHierarchy(box);
        box.determineLayout();
      } else {
        box.children.forEach(flattenHierarchy);
      }
    }
    flattenHierarchy(root);
    function flattenHierarchy2(box) {
      if (box.children.length > 1 && box.layout.numCols === 1 && box.children.every((child) => child.layout.numRows === 0 && child.layout.numCols === 0)) {
        box.children = [];
        flattenHierarchy2(box);
        box.determineLayout();
      } else {
        box.children.forEach(flattenHierarchy2);
      }
    }
    flattenHierarchy2(root);
    function mergeMultiSingleRowColums(box) {
      if (box.children.length > 1) {
        const { numCols } = box.children[0].layout;
        if (box.layout.numRows > 1 && box.layout.numCols === 1 && box.children.every((child) => child.layout.numRows === 1 && child.layout.numCols > 1 && child.layout.numCols === numCols)) {
          console.log("mergeMultiSingleRowColums", box);
          const newChildren = [];
          box.children.forEach((child) => {
            newChildren.push(...child.children);
          });
          box.children = newChildren;
          box.determineLayout();
        } else {
          box.children.forEach(mergeMultiSingleRowColums);
        }
      }
    }
    mergeMultiSingleRowColums(root);
    computeLayout(root);
    return root;
  };
  xp2.getVerticalBoxesFromHierarchy = (boxes) => {
    const root = { ...boxes };
    function getVerticalBoxes(box) {
      const { children } = box;
      const hasHorizontalEls = children.some((child1) => children.some((child2) => {
        if (child1 !== child2 && !child1.isInside(child2) && (child1.x >= child2.x + child2.width || child1.x + child1.width <= child2.x)) {
          return true;
        }
        return false;
      }));
      if (hasHorizontalEls) {
        box.setChildren([]);
      } else {
        for (let i = 0; i < children.length; i += 1) {
          getVerticalBoxes(children[i]);
        }
      }
    }
    getVerticalBoxes(root);
    return root.children;
  };
  xp2.boxes = null;
  xp2.selectElementToIgnore = () => {
    document.body.style.cursor = "crosshair";
    const target = xp2.ui.overlaysDiv();
    target.addEventListener(
      "click",
      (e) => {
        const el = e.target;
        if (el.classList.contains("xp-overlay")) {
          el.remove();
        }
        xp2.ignoreElementForDection(el.dataset.boxId);
        document.body.style.removeProperty("cursor");
      },
      { once: true }
    );
  };
  xp2.ignoreElementForDection = (boxId) => {
    function deleteOverlayDivs(box) {
      const target = xp2.ui.overlaysDiv();
      [...target.querySelectorAll(".xp-overlay")].forEach((el) => {
        if (el.dataset.boxId === box.id) {
          el.remove();
        }
      });
      box.children.forEach(deleteOverlayDivs);
    }
    function findBox(box) {
      if (box.id === boxId) {
        box.ignored = true;
        deleteOverlayDivs(box);
        return true;
      } else {
        return box.children.some(findBox);
      }
    }
    findBox(xp2.boxes);
  };
  xp2.predictPage = (window2) => {
    const finalBoxes = [];
    function displayPrediction(box) {
      if (!box.ignored) {
        if (box.prediction && box.prediction.sectionType !== "container" || box.prediction && box.prediction.sectionType === "container" && box.children.length === 0) {
          finalBoxes.push(box);
          console.warn(box.div, box.prediction);
          if (xp2.ui) {
            highlightBox(box, {
              window: window2,
              padding: 0,
              color: "rgba(0, 255, 0, 1)",
              label: box.prediction.sectionType
            });
          }
        } else {
          box.children.forEach(displayPrediction);
        }
      }
    }
    if (xp2.boxes?.children?.length > 0) {
      xp2.ui?.resetOverlays();
      predictSection(xp2.boxes, 0, null, window2);
      displayPrediction(xp2.boxes);
      const boxesTpl = xp2.boxes.children.map((child) => {
        const tpl = [DOM.getXPath(child.div, document)];
        tpl.push(...child.children.map((c) => `- ${DOM.getXPath(c.div, document)}`));
        return tpl.join("\n") || "";
      }).join("\n") || "";
      xp2.boxes.template = {
        raw: boxesTpl,
        hash: hashCode(boxesTpl)
      };
      xp2.predictedBoxes = finalBoxes;
      console.log("final boxes", xp2.boxes);
      console.log("predicted boxes", xp2.predictedBoxes);
      xp2.ui?.toggleOverlays(true);
      return xp2.boxes;
    } else {
      console.error("no boxes to predict");
      return [];
    }
  };
  xp2.detectSections = async (root, window2, options = {}) => {
    options = {
      autoDetect: false,
      reduceContent: false,
      highlightBoxes: true,
      highlightSections: true,
      debug: false,
      ...options
    };
    xp2.ui?.resetOverlays();
    const { document: document2 } = window2;
    let divs = DOM.getAllVisibleElements(window2, root);
    console.log("visible divs", divs);
    divs = divs.filter((div) => {
      const rect = div.getBoundingClientRect();
      return rect.width * rect.height > 1e4 && !div.parentElement.closest("table, form");
    });
    divs = divs.filter((el) => {
      const rect = el.getBoundingClientRect();
      const elArea = rect.width * rect.height;
      let p = el.parentElement;
      while (p) {
        const pS = window2.getComputedStyle(p);
        if (pS.display.includes("none") || pS.visibility.includes("hidden") || pS.opacity === "0") {
          return false;
        }
        const pRect = p.getBoundingClientRect();
        if (pS.overflow === "hidden" && (pRect.height === 0 || pRect.width === 0 || elArea > pRect.width * pRect.height)) {
          return false;
        }
        p = p.parentElement;
      }
      return true;
    });
    console.log("filtered divs", divs);
    const boxes = xp2.buildBoxTree(divs, window2);
    console.log("boxes hierarchy", boxes);
    function setXPath(box, document22) {
      if (box.div) {
        box.xpath = DOM.getXPath(box.div, document22);
        box.xpathWithDetails = XPath.getRelativeXPath(box.div, true);
        box.id = `box-id-${hashCode(box.xpath)}`;
      }
      if (box.children && box.children.length > 0) {
        box.children.forEach((c) => setXPath(c, document22));
      }
    }
    setXPath(boxes, document2);
    const sectionTpl = boxes.children.map((child) => {
      const tpl = [child.xpath];
      tpl.push(...child.children.map((c) => `- ${c.xpath}`));
      return tpl.join("\n") || "";
    }).join("\n") || "";
    console.log("template", sectionTpl);
    xp2.template = {
      raw: sectionTpl,
      hash: hashCode(sectionTpl)
    };
    let finalBoxes = [];
    function displayPrediction(box) {
      if (!box.ignored) {
        if (box.div && (box.prediction && !["unknown", "container"].includes(box.prediction.sectionType) || box.prediction && ["unknown", "container"].includes(box.prediction.sectionType) && box.children.length === 0 || box.prediction && ["unknown", "container"].includes(box.prediction.sectionType) && box.children.length > 0 && box.layout.numCols > 1 || box.prediction && ["unknown", "container"].includes(box.prediction.sectionType) && box.children.length > 0 && box.children.every((child) => child.prediction.sectionType === "default-content"))) {
          finalBoxes.push(box);
        } else {
          box.children.forEach(displayPrediction);
        }
      }
    }
    if (!options.autoDetect) {
      if (options.highlightBoxes) {
        highlightAllBoxes(boxes.children, window2);
      }
    } else if (boxes?.children?.length > 0) {
      predictSection(boxes, 0, null, window2);
      boxes.children.forEach((box) => {
        box.determineLayout();
      });
      displayPrediction(boxes);
      finalBoxes = finalBoxes.filter(
        (box) => !finalBoxes.find((b) => box.xpath !== b.xpath && b.xpath.startsWith(box.xpath))
      );
      finalBoxes.forEach(async (box) => {
        if (options.reduceContent) {
          await reduceContent(box.div, document2);
          const shadowRoots = findShadowRoots(box.div);
          console.log("shadowRoots", shadowRoots);
          for (const sroot of shadowRoots) {
            await reduceContent(sroot, document2);
          }
          document2.body.querySelectorAll("script, style").forEach((el) => {
            el.remove();
          });
          document2.body.querySelectorAll("a").forEach((el) => {
            if (!el.href) {
              el.remove();
            }
          });
        }
        console.log("label", box.prediction.sectionType);
      });
      const pageTpl = boxes.children.map((child) => {
        const tpl = [DOM.getXPath(child.div, document2)];
        tpl.push(...child.children.map((c) => `- ${DOM.getXPath(c.div, document2)}`));
        return tpl.join("\n") || "";
      }).join("\n") || "";
      boxes.template = {
        raw: pageTpl,
        hash: hashCode(pageTpl)
      };
      finalBoxes = identifyTabs(finalBoxes, document2, window2);
      boxes.predictedBoxes = finalBoxes;
      console.log("final boxes", finalBoxes);
      if (options.highlightBoxes) {
        finalBoxes.forEach((box) => {
          highlightBox(box, {
            window: window2,
            target: window2.document.body,
            padding: 4,
            color: box.color,
            label: box.prediction.sectionType
          });
        });
      }
      let mainDocStyledEl = null;
      if (elementHasStyledBackground(document2.body, window2)) {
        mainDocStyledEl = document2.body;
      } else if (elementHasStyledBackground(document2.documentElement, window2)) {
        mainDocStyledEl = document2.documentElement;
      }
      if (mainDocStyledEl) {
        console.log("mainDocIsStyled", mainDocStyledEl.nodeName);
        const sectionRect = document2.body.getBoundingClientRect();
        const sectionBox = new Box(
          sectionRect.x,
          sectionRect.y,
          sectionRect.width,
          sectionRect.height,
          options.debug ? mainDocStyledEl : null
        );
        sectionBox.xpath = DOM.getXPath(document2.body, document2);
        sectionBox.xpathWithDetails = XPath.getRelativeXPath(document2.body, true);
        sectionBox.id = `box-id-${hashCode(sectionBox.xpath)}`;
        boxes.section = {
          box: sectionBox,
          styles: {
            background: window2.getComputedStyle(mainDocStyledEl).background
          }
        };
      }
      boxes.predictedBoxes.forEach((box) => {
        let styledSection = findStyledSectionChildren(
          box.div,
          window2,
          boxes.section?.styles?.background
        );
        if (!styledSection) {
          styledSection = closestStyledSectionAncestor(
            box.div,
            window2,
            boxes.section?.styles?.background
          );
        }
        if (styledSection) {
          const sectionBackground = window2.getComputedStyle(styledSection).background;
          if (!boxes.section || boxes.section && boxes.section.styles.background !== sectionBackground) {
            console.log("styledSection", styledSection, sectionBackground);
            const sectionRect = styledSection.getBoundingClientRect();
            const sectionBox = new Box(
              sectionRect.x,
              sectionRect.y,
              sectionRect.width,
              sectionRect.height,
              options.debug ? styledSection : null
            );
            sectionBox.xpath = DOM.getXPath(styledSection, document2);
            sectionBox.xpathWithDetails = XPath.getRelativeXPath(styledSection, true);
            sectionBox.id = `box-id-${hashCode(sectionBox.xpath)}`;
            box.section = {
              box: sectionBox,
              styles: {
                background: sectionBackground
              }
            };
            if (options.highlightSections) {
              highlightBox(sectionBox, {
                window: window2,
                target: window2.document.body,
                padding: 1,
                color: "rgba(0, 144, 0, 0.8)",
                label: "styled section",
                extraClass: "bottomRight"
              });
            }
          }
        }
      });
    }
    xp2.ui?.toggleOverlays(true);
    xp2.boxes = boxes;
    return boxes;
  };
  xp2.reduceContent = async (box, document2) => {
    await reduceContent(box.div, document2);
    const shadowRoots = findShadowRoots(box.div);
    console.log("shadowRoots", shadowRoots);
    for (const sroot of shadowRoots) {
      await reduceContent(sroot, document2);
    }
    document2.body.querySelectorAll("script, style").forEach((el) => {
      el.remove();
    });
    document2.body.querySelectorAll("a").forEach((el) => {
      if (!el.href) {
        el.remove();
      }
    });
  };
  if (true) {
    xp2.ui = new UI();
    xp2.ui.show();
  }
  window.xp = xp2;
})();
(() => {
  // src/utils/cleanup.js
  var NOISE_TAGS = ["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META"];
  var STYLING_TAGS = ["B", "EM", "STRONG", "U", "S", "I", "MARK", "SMALL", "DEL", "INS", "SUB", "SUP"];
  var KEEP_ATTRIBUTES = /* @__PURE__ */ new Set([
    "class",
    "id",
    "role",
    "href",
    "src",
    "alt",
    "type",
    "name",
    "action",
    "method",
    "for",
    "placeholder"
  ]);
  var STRIP_DATA_PREFIXES = [
    "data-analytics",
    "data-tracking",
    "data-gtm",
    "data-testid",
    "data-test-",
    "data-cy"
  ];
  function shouldKeepAttribute(attr) {
    if (KEEP_ATTRIBUTES.has(attr.name)) return true;
    if (attr.name.startsWith("aria-")) return true;
    if (attr.name.startsWith("data-")) {
      return !STRIP_DATA_PREFIXES.some((prefix) => attr.name.startsWith(prefix));
    }
    return false;
  }
  function removeNoiseElements(root) {
    root.querySelectorAll(NOISE_TAGS.join(",")).forEach((el) => el.remove());
  }
  function removeInvisibleElements(root, win) {
    [...root.querySelectorAll("*")].forEach((el) => {
      const s = win.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") {
        el.remove();
      }
    });
  }
  function stripStylingTags(root) {
    const doc = root.ownerDocument;
    let el = root.querySelector(STYLING_TAGS.join(","));
    while (el) {
      const parent = el.parentElement;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent), el);
      }
      el = root.querySelector(STYLING_TAGS.join(","));
    }
  }
  var SHOW_COMMENT = 128;
  function removeComments(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    comments.forEach((c) => c.remove());
  }
  function stripAttributes(root) {
    [...root.querySelectorAll("*")].forEach((el) => {
      const toRemove = [];
      for (const attr of el.attributes) {
        if (!shouldKeepAttribute(attr)) {
          toRemove.push(attr.name);
        }
      }
      toRemove.forEach((attrName) => el.removeAttribute(attrName));
    });
  }
  function cleanupAll(root, win) {
    removeNoiseElements(root);
    removeInvisibleElements(root, win);
    stripStylingTags(root);
    removeComments(root);
    stripAttributes(root);
  }

  // src/utils/tokenize.js
  var VIDEO_DOMAINS = [
    "youtube.com",
    "vimeo.com",
    "dailymotion.com",
    "wistia.com",
    "twitch.tv",
    "vidyard.com",
    "brightcove.com",
    "kaltura.com",
    "streamable.com",
    "ted.com"
  ];
  var VIDEO_EXTENSIONS = ["mp4", "webm", "ogg", "mov", "avi"];
  var HEADING_TAGS = /* @__PURE__ */ new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  var ICON_THRESHOLD = 64;
  var TOKEN_PATTERN = /^\{[A-Z]+[^}]*\}$/;
  var SHOW_TEXT = 4;
  var PRESERVED_VOID_TAGS = /* @__PURE__ */ new Set([
    "BR",
    "HR",
    "IMG",
    "INPUT",
    "TEXTAREA",
    "SELECT"
  ]);
  function isVideoSource(src) {
    if (!src) return false;
    return VIDEO_DOMAINS.some((d) => src.includes(d)) || VIDEO_EXTENSIONS.some((ext) => src.endsWith(`.${ext}`));
  }
  function isToken(text) {
    return TOKEN_PATTERN.test(text.trim());
  }
  function getVisibleText(el) {
    return el.textContent.replace(/\s+/g, " ").trim();
  }
  function tokenizeHeadings(root) {
    HEADING_TAGS.forEach((tag) => {
      root.querySelectorAll(tag).forEach((el) => {
        const level = tag.charAt(1);
        el.textContent = `{HEADING:${level}}`;
      });
    });
  }
  function tokenizeTextNodes(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    nodes.forEach((node) => {
      const text = node.data.replace(/\s+/g, " ").trim();
      if (text.length > 0 && !isToken(text)) {
        node.data = "{TEXT}";
      }
    });
  }
  function tokenizeImages(root) {
    const doc = root.ownerDocument;
    root.querySelectorAll("img").forEach((img) => {
      const rect = img.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const token = w > ICON_THRESHOLD && h > ICON_THRESHOLD ? `{IMAGE:${w}x${h}}` : "{ICON}";
      img.replaceWith(doc.createTextNode(token));
    });
    root.querySelectorAll("svg").forEach((svg) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= ICON_THRESHOLD || rect.height <= ICON_THRESHOLD) {
        svg.replaceWith(doc.createTextNode("{ICON}"));
      }
    });
    root.querySelectorAll("picture").forEach((picture) => {
      const img = picture.querySelector("img");
      if (img) {
        picture.replaceWith(img);
      } else {
        picture.replaceWith(doc.createTextNode("{IMAGE:0x0}"));
      }
    });
  }
  function tokenizeVideos(root) {
    const doc = root.ownerDocument;
    root.querySelectorAll("video").forEach((video) => {
      video.replaceWith(doc.createTextNode("{VIDEO}"));
    });
    root.querySelectorAll("iframe, embed, object").forEach((el) => {
      const src = el.src || el.getAttribute("data") || "";
      if (isVideoSource(src)) {
        el.replaceWith(doc.createTextNode("{VIDEO}"));
      }
    });
  }
  function isCTALink(el, win) {
    const doc = el.ownerDocument;
    const s = win.getComputedStyle(el);
    const defaultA = doc.createElement("a");
    doc.body.appendChild(defaultA);
    const defaultS = win.getComputedStyle(defaultA);
    const hasCustomBg = s.backgroundColor !== defaultS.backgroundColor || s.backgroundImage !== defaultS.backgroundImage;
    let borderCount = 0;
    ["left", "right", "top", "bottom"].forEach((side) => {
      const prop = `border-${side}-style`;
      if (s.getPropertyValue(prop) !== defaultS.getPropertyValue(prop)) {
        borderCount += 1;
      }
    });
    defaultA.remove();
    return hasCustomBg || borderCount > 1;
  }
  function tokenizeLinks(root, win) {
    const doc = root.ownerDocument;
    root.querySelectorAll("a[href]").forEach((a) => {
      const label = getVisibleText(a);
      if (isCTALink(a, win)) {
        a.replaceWith(doc.createTextNode(`{CTA:${label}}`));
      } else {
        a.replaceWith(doc.createTextNode(`{LINK:${label}}`));
      }
    });
  }
  function tokenizeFormElements(root) {
    const doc = root.ownerDocument;
    root.querySelectorAll("select").forEach((select) => {
      const count = select.options ? select.options.length : select.querySelectorAll("option").length;
      select.replaceWith(doc.createTextNode(`{SELECT:${count}}`));
    });
    root.querySelectorAll("input").forEach((input) => {
      const type = input.getAttribute("type") || "text";
      input.replaceWith(doc.createTextNode(`{INPUT:${type}}`));
    });
    root.querySelectorAll("textarea").forEach((ta) => {
      ta.replaceWith(doc.createTextNode("{INPUT:textarea}"));
    });
  }
  function collapseWhitespace(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    nodes.forEach((node) => {
      node.data = node.data.replace(/\s+/g, " ");
      if (node.data.trim().length === 0 && node.parentElement && node.parentElement.children.length > 0) {
        node.data = "";
      }
    });
  }
  function removeEmptyOnce(root) {
    let removed = false;
    for (const el of [...root.querySelectorAll("*")]) {
      if (el.children.length === 0 && el.textContent.trim().length === 0 && !PRESERVED_VOID_TAGS.has(el.tagName)) {
        el.remove();
        removed = true;
      }
    }
    return removed;
  }
  function removeEmptyElements(root) {
    while (removeEmptyOnce(root)) {
    }
  }
  function tokenizeAll(root, win) {
    tokenizeHeadings(root);
    tokenizeVideos(root);
    tokenizeImages(root);
    tokenizeLinks(root, win);
    tokenizeFormElements(root);
    tokenizeTextNodes(root);
    collapseWhitespace(root);
    removeEmptyElements(root);
  }

  // src/utils/dom.js
  var DOM = class _DOM {
    static getXPath(el, document2, withDetails = false) {
      const allNodes = document2.getElementsByTagName("*");
      const segs = [];
      for (let elm = el; elm && elm.nodeType === 1; elm = elm.parentNode) {
        if (withDetails) {
          if (elm.hasAttribute("id")) {
            let uniqueIdCount = 0;
            for (let n = 0; n < allNodes.length; n += 1) {
              if (allNodes[n].hasAttribute("id") && allNodes[n].id === elm.id) {
                uniqueIdCount += 1;
              }
              if (uniqueIdCount > 1) {
                break;
              }
            }
            if (uniqueIdCount === 1) {
              segs.unshift(`id("${elm.getAttribute("id")}")`);
              return segs.join("/");
            } else {
              segs.unshift(`${elm.localName.toLowerCase()}[@id="${elm.getAttribute("id")}"]`);
            }
          } else if (elm.hasAttribute("class")) {
            segs.unshift(`${elm.localName.toLowerCase()}[@class="${[...elm.classList].join(" ").trim()}"]`);
          }
        } else {
          let i = 1;
          for (let sib = elm.previousSibling; sib; sib = sib.previousSibling) {
            if (sib.localName === elm.localName) {
              i += 1;
            }
          }
          segs.unshift(`${elm.localName.toLowerCase()}[${i}]`);
        }
      }
      return segs.length ? `/${segs.join("/")}` : null;
    }
    // check element and all parents if they are visible
    static isVisible(el, window2) {
      if (!el) {
        return false;
      }
      if (el.nodeType === window2.Node.DOCUMENT_NODE) {
        return true;
      }
      if (el.nodeType === window2.Node.ELEMENT_NODE) {
        const s = window2.getComputedStyle(el);
        if (s.display.includes("none") || s.visibility.includes("hidden") || s.opacity === "0") {
          return false;
        }
        const rect = el.getBoundingClientRect();
        const elArea = rect.width * rect.height;
        let p = el.parentElement;
        while (p) {
          const pS = window2.getComputedStyle(p);
          if (pS.display.includes("none") || pS.visibility.includes("hidden") || pS.opacity === "0") {
            return false;
          }
          const pRect = p.getBoundingClientRect();
          if (pS.overflow === "hidden" && (pRect.height === 0 || pRect.width === 0)) {
            console.log("parent is hiding the element");
            console.log("parent", p);
            console.log("parent rect", pRect);
            console.log("element rect", rect);
            console.log("areas", "e", elArea, "p", pRect.width * pRect.height);
            return false;
          }
          p = p.parentElement;
        }
        return true;
      }
      return false;
    }
    static isUserVisible(el, window2) {
      if (!_DOM.isVisible(el, window2)) {
        return false;
      }
      const elStyles = window2.getComputedStyle(el);
      if (el.assignedSlot) {
        const slotVisible = _DOM.isUserVisible(el.assignedSlot.parentElement, window2);
        return slotVisible;
      } else if (elStyles.display !== "contents") {
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0 || [...el.children].filter((c) => !["BR", "SCRIPT", "STYLE"].includes(c.tagName)).length === 0 && (rect.width * rect.height === 0 || el.textContent.trim().replaceAll("\n", "").length === 0 && !["IMG", "VIDEO", "CANVAS", "SVG", "PICTURE", "EMBED"].includes(el.tagName) && !_DOM.hasBackgroundImage(el, window2))) {
          return false;
        }
      }
      return true;
    }
    // courtesy of https://github.com/adobecom/aem-milo-migrations/blob/main/tools/importer/parsers/utils.js
    static getNSiblingsSameTag(el, tag, document2, n = null) {
      let cmpFn = n;
      if (typeof n === "number") {
        cmpFn = (c) => c === n;
      }
      let selectedXpathPattern = "";
      const xpathGrouping = [];
      el.querySelectorAll(tag).forEach((d) => {
        const xpath = _DOM.getXPath(d, document2);
        const xp = xpath.substring(0, xpath.lastIndexOf("["));
        if (!xpathGrouping[xp]) {
          xpathGrouping[xp] = [d];
        } else {
          xpathGrouping[xp].push(d);
        }
      });
      for (const key of Object.keys(xpathGrouping)) {
        if (cmpFn(xpathGrouping[key].length)) {
          selectedXpathPattern = key;
          break;
        }
      }
      return xpathGrouping[selectedXpathPattern] || null;
    }
    static getNSiblingsDivs(el, document2, n = null) {
      return _DOM.getNSiblingsSameTag(el, "div", document2, n);
    }
    static getNSiblingsSameLi(el, document2, n = null) {
      return _DOM.getNSiblingsSameTag(el, "li", document2, n);
    }
    static getPageSize(document2) {
      const htmlElement = document2.documentElement;
      const bodyElement = document2.body;
      const width = Math.max(
        htmlElement.clientWidth,
        htmlElement.scrollWidth,
        htmlElement.offsetWidth,
        bodyElement.scrollWidth,
        bodyElement.offsetWidth
      );
      const height = Math.max(
        htmlElement.clientHeight,
        htmlElement.scrollHeight,
        htmlElement.offsetHeight,
        bodyElement.scrollHeight,
        bodyElement.offsetHeight
      );
      return { width, height };
    }
    static getOffsetRect(el, window2) {
      const rect = el.getBoundingClientRect();
      const left = window2.document?.scrollingElement?.scrollLeft || 0;
      const top = window2.document?.scrollingElement?.scrollTop || 0;
      return {
        x: rect.left + left,
        y: rect.top + top,
        width: rect.width,
        height: rect.height
      };
    }
    static checkElStackUpCSSClasses(el, pattern) {
      let parent = el;
      while (parent) {
        if (parent.classList.contains(pattern)) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }
    static getAllVisibleElements = (window2, root = document.body) => {
      const types = [...root.querySelectorAll("*")].filter((el) => !["IFRAME", "NOSCRIPT", "BR", "EM", "STRONG", "STYLE", "SCRIPT"].includes(el.nodeName)).reduce((acc, currValue) => {
        const cl = currValue.closest("svg");
        if (!(cl !== null && cl !== currValue) && !acc.includes(currValue.nodeName) && /^[A-Z0-9-_]+$/.test(currValue.nodeName)) {
          acc.push(currValue.nodeName);
        }
        return acc;
      }, []);
      console.log("DOM node types:", types);
      const divs = [...root.querySelectorAll(types.join(","))].filter((el) => !el.closest("figure"));
      const visibleElements = divs.filter((e) => _DOM.isUserVisible(e, window2));
      console.log(`found ${visibleElements.length} visible elements in the page.`);
      return visibleElements;
    };
    static hasBackgroundImage(el, window2) {
      const elRect = el.getBoundingClientRect();
      const elArea = elRect.width * elRect.height;
      const bg = [el, ...el.querySelectorAll("*")].filter((c) => {
        const r = c.getBoundingClientRect();
        const a = r.width * r.height;
        return a >= elArea * 0.8;
      }).find((c) => {
        const s = window2.getComputedStyle(c);
        return s.backgroundImage && !s.backgroundImage.includes("none");
      });
      if (bg) {
        return true;
      }
      const images = [...el.querySelectorAll("img")].filter((i) => {
        const r = i.getBoundingClientRect();
        const a = r.width * r.height;
        return _DOM.isUserVisible(i, window2) && a >= elArea * 0.8;
      });
      if (images && images.length === 1) {
        return true;
      }
      return false;
    }
  };

  // src/utils/dom/step.js
  var Step = class {
    value;
    optimized;
    constructor(value, optimized) {
      this.value = value;
      this.optimized = optimized || false;
    }
    toString() {
      return this.value;
    }
  };

  // src/utils/dom/xpath.js
  function xPathIndex(node) {
    function areNodesSimilar(left, right) {
      if (left === right) {
        return true;
      }
      if (left.nodeType === Node.ELEMENT_NODE && right.nodeType === Node.ELEMENT_NODE) {
        return left.nodeName === right.nodeName;
      }
      if (left.nodeType === right.nodeType) {
        return true;
      }
      const leftType = left.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : left.nodeType;
      const rightType = right.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : right.nodeType;
      return leftType === rightType;
    }
    const siblings = node.parentElement ? node.parentElement.children : null;
    if (!siblings) {
      return 0;
    }
    let hasSameNamedElements;
    for (let i = 0; i < siblings.length; ++i) {
      if (areNodesSimilar(node, siblings[i]) && siblings[i] !== node) {
        hasSameNamedElements = true;
        break;
      }
    }
    if (!hasSameNamedElements) {
      return 0;
    }
    let ownIndex = 1;
    for (let i = 0; i < siblings.length; ++i) {
      if (areNodesSimilar(node, siblings[i])) {
        if (siblings[i] === node) {
          return ownIndex;
        }
        ++ownIndex;
      }
    }
    return -1;
  }
  function xPathValue(node, optimized) {
    let ownValue;
    const ownIndex = xPathIndex(node);
    if (ownIndex === -1) {
      return null;
    }
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        if (optimized && node.getAttribute("id")) {
          return new Step(`//*[@id="${node.getAttribute("id")}"]`, true);
        }
        ownValue = node.nodeName.toLowerCase();
        break;
      case Node.ATTRIBUTE_NODE:
        ownValue = `@${node.nodeName.toLowerCase()}`;
        break;
      case Node.TEXT_NODE:
      case Node.CDATA_SECTION_NODE:
        ownValue = "text()";
        break;
      case Node.PROCESSING_INSTRUCTION_NODE:
        ownValue = "processing-instruction()";
        break;
      case Node.COMMENT_NODE:
        ownValue = "comment()";
        break;
      case Node.DOCUMENT_NODE:
        ownValue = "";
        break;
      default:
        ownValue = "";
        break;
    }
    if (ownIndex > 0) {
      ownValue += `[${ownIndex}]`;
    }
    return new Step(ownValue, node.nodeType === Node.DOCUMENT_NODE);
  }
  var XPath = class {
    static getRelativeXPath(node, optimized) {
      if (node.nodeType === Node.DOCUMENT_NODE) {
        return "/";
      }
      const steps = [];
      let contextNode = node || null;
      while (contextNode) {
        const step = xPathValue(contextNode, optimized);
        if (!step) {
          break;
        }
        steps.push(step);
        if (step.optimized) {
          break;
        }
        contextNode = contextNode.parentNode;
      }
      steps.reverse();
      return (steps.length && steps[0].optimized ? "" : "/") + steps.join("/");
    }
  };

  // src/utils/utils.js
  function hashCode(s) {
    let h = 0;
    const l = s.length;
    let i = 0;
    if (l > 0) while (i < l) h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
  }

  // src/utils/reduce.js
  function findShadowRoots(ele) {
    return [
      ele,
      ...ele.querySelectorAll("*")
    ].filter((e) => !!e.shadowRoot).flatMap((e) => [e.shadowRoot, ...findShadowRoots(e.shadowRoot)]);
  }

  // src/reduce-for-skill.js
  function processSectionBox(box, doc, win) {
    const el = box.div;
    if (!el) return null;
    const clone = el.cloneNode(true);
    cleanupAll(clone, win);
    const shadowRoots = findShadowRoots(clone);
    for (const sroot of shadowRoots) {
      cleanupAll(sroot, win);
      tokenizeAll(sroot, win);
    }
    tokenizeAll(clone, win);
    return {
      sectionType: box.prediction?.sectionType || "unknown",
      xpath: box.xpath || DOM.getXPath(el, doc),
      xpathWithDetails: box.xpathWithDetails || XPath.getRelativeXPath(el, true),
      tokenizedHtml: clone.outerHTML,
      layout: box.layout || { numCols: 0, numRows: 0 },
      features: box.prediction?.sectionFeatures || [],
      section: box.section ? {
        xpath: box.section.box?.xpath,
        background: box.section.styles?.background
      } : null
    };
  }
  function reduceForSkill(root, win) {
    const doc = win.document;
    const boxes = win.xp?.boxes;
    if (!boxes || !boxes.predictedBoxes) {
      return { url: win.location.href, sections: [] };
    }
    const sections = [];
    boxes.predictedBoxes.forEach((box, index) => {
      const section = processSectionBox(box, doc, win);
      if (section) {
        section.index = index;
        sections.push(section);
      }
    });
    const pageTpl = boxes.children?.map((child) => {
      const tpl = [DOM.getXPath(child.div, doc)];
      tpl.push(...child.children.map((c) => `- ${DOM.getXPath(c.div, doc)}`));
      return tpl.join("\n") || "";
    }).join("\n") || "";
    return {
      url: win.location.href,
      title: doc.title,
      viewport: { width: win.innerWidth },
      templateHash: hashCode(pageTpl).toString(),
      sections
    };
  }
  if (typeof window !== "undefined" && window.xp) {
    window.__reduceForSkill = reduceForSkill;
  }
})();
