// Copyright 2015 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {Source,SourceResolver,sourcePositionToStringKey} from "./source-resolver.js"
import {SelectionBroker} from "./selection-broker.js"
import {View} from "./view.js"
import {MySelection} from "./selection.js"
import {anyToString,ViewElements} from "./util.js"

export enum CodeMode {
  MAIN_SOURCE = "main function",
  INLINED_SOURCE = "inlined function"
};

export class CodeView extends View {
  broker: SelectionBroker;
  source: Source;
  sourceResolver: SourceResolver;
  codeMode: CodeMode;
  sourcePositionToHtmlElement: Map<string, HTMLElement>;
  showAdditionalInliningPosition: boolean;
  selectionHandler: SelectionHandler;
  selection: MySelection;

  createViewElement() {
    const sourceContainer = document.createElement("div");
    sourceContainer.classList.add("source-container");
    return sourceContainer;
  }

  constructor(parentId, broker, sourceResolver, sourceFunction, codeMode: CodeMode) {
    super(parentId);
    let view = this;
    view.broker = broker;
    view.source = null;
    view.sourceResolver = sourceResolver;
    view.source = sourceFunction;
    view.codeMode = codeMode;
    this.sourcePositionToHtmlElement = new Map();
    this.showAdditionalInliningPosition = false;

    const selectionHandler = {
      clear: function () {
        view.selection.clear();
        view.updateSelection();
        broker.broadcastClear(this)
      },
      select: function (sourcePositions, selected) {
        const locations = [];
        for (var sourcePosition of sourcePositions) {
          locations.push(sourcePosition);
          sourceResolver.addInliningPositions(sourcePosition, locations);
        }
        if (locations.length == 0) return;
        view.selection.select(locations, selected);
        view.updateSelection();
        broker.broadcastSourcePositionSelect(this, locations, selected);
      },
      brokeredSourcePositionSelect: function (locations, selected) {
        const firstSelect = view.selection.isEmpty();
        for (const location of locations) {
          const translated = sourceResolver.translateToSourceId(view.source.sourceId, location);
          if (!translated) continue;
          view.selection.select(translated, selected);
        }
        view.updateSelection(firstSelect);
      },
      brokeredClear: function () {
        view.selection.clear();
        view.updateSelection();
      },
    };
    view.selection = new MySelection(sourcePositionToStringKey);
    broker.addSourcePositionHandler(selectionHandler);
    this.selectionHandler = selectionHandler;
    this.initializeCode();
  }

  addHtmlElementToSourcePosition(sourcePosition, element) {
    const key = sourcePositionToStringKey(sourcePosition);
    if (this.sourcePositionToHtmlElement.has(key)) {
      console.log("Warning: duplicate source position", sourcePosition);
    }
    this.sourcePositionToHtmlElement.set(key, element);
  }

  getHtmlElementForSourcePosition(sourcePosition) {
    const key = sourcePositionToStringKey(sourcePosition);
    return this.sourcePositionToHtmlElement.get(key);
  }

  updateSelection(scrollIntoView: boolean = false): void {
    const mkVisible = new ViewElements(this.divNode.parentNode as HTMLElement);
    for (const [sp, el] of this.sourcePositionToHtmlElement.entries()) {
      const isSelected = this.selection.isKeySelected(sp);
      mkVisible.consider(el, isSelected);
      el.classList.toggle("selected", isSelected);
    }
    mkVisible.apply(scrollIntoView);
  }

  initializeContent(data, rememberedSelection) {
  }

  getCodeHtmlElementName() {
    return `source-pre-${this.source.sourceId}`;
  }

  getCodeHeaderHtmlElementName() {
    return `source-pre-${this.source.sourceId}-header`;
  }

  getHtmlCodeLines(): NodeListOf<HTMLElement> {
    const ordereList = this.divNode.querySelector(`#${this.getCodeHtmlElementName()} ol`);
    return ordereList.childNodes as NodeListOf<HTMLElement>;
  }

  onSelectLine(lineNumber: number, doClear: boolean) {
    const key = anyToString(lineNumber);
    if (doClear) {
      this.selectionHandler.clear();
    }
    const positions = this.sourceResolver.linetoSourcePositions(lineNumber - 1);
    if (positions !== undefined) {
      this.selectionHandler.select(positions, undefined);
    }
  }

  onSelectSourcePosition(sourcePosition, doClear) {
    if (doClear) {
      this.selectionHandler.clear();
    }
    this.selectionHandler.select([sourcePosition], undefined);
  }

  initializeCode() {
    var view = this;
    const source = this.source;
    const sourceText = source.sourceText;
    if (!sourceText) return;
    const sourceContainer = view.divNode;
    if (this.codeMode == CodeMode.MAIN_SOURCE) {
      sourceContainer.classList.add("main-source");
    } else {
      sourceContainer.classList.add("inlined-source");
    }
    var codeHeader = document.createElement("div");
    codeHeader.setAttribute("id", this.getCodeHeaderHtmlElementName());
    codeHeader.classList.add("code-header");
    var codeFileFunction = document.createElement("div");
    codeFileFunction.classList.add("code-file-function");
    codeFileFunction.innerHTML = `${source.sourceName}:${source.functionName}`;
    codeHeader.appendChild(codeFileFunction);
    var codeModeDiv = document.createElement("div");
    codeModeDiv.classList.add("code-mode");
    codeModeDiv.innerHTML = `${this.codeMode}`;
    codeHeader.appendChild(codeModeDiv);
    const clearDiv = document.createElement("div");
    clearDiv.style.clear = "both";
    codeHeader.appendChild(clearDiv);
    sourceContainer.appendChild(codeHeader);
    var codePre = document.createElement("pre");
    codePre.setAttribute("id", this.getCodeHtmlElementName());
    codePre.classList.add("prettyprint");
    sourceContainer.appendChild(codePre);

    codeHeader.onclick = function myFunction() {
      if (codePre.style.display === "none") {
        codePre.style.display = "block";
      } else {
        codePre.style.display = "none";
      }
    }
    if (sourceText != "") {
      codePre.classList.add("linenums");
      codePre.textContent = sourceText;
      try {
        // Wrap in try to work when offline.
        PR.prettyPrint(undefined, sourceContainer);
      } catch (e) {
        console.log(e);
      }

      view.divNode.onclick = function (e) {
        view.selectionHandler.clear();
      }

      const base: number = source.startPosition;
      let current = 0;
      const lineListDiv = this.getHtmlCodeLines();
      let newlineAdjust = 0;
      for (let i = 0; i < lineListDiv.length; i++) {
        // Line numbers are not zero-based.
        const lineNumber = i + 1;
        const currentLineElement = lineListDiv[i];
        currentLineElement.id = "li" + i;
        currentLineElement.dataset.lineNumber = "" + lineNumber;
        const spans = currentLineElement.childNodes;
        for (let j = 0; j < spans.length; ++j) {
          const currentSpan = spans[j];
          const pos = base + current;
          const end = pos + currentSpan.textContent.length;
          current += currentSpan.textContent.length;
          this.insertSourcePositions(currentSpan, lineNumber, pos, end, newlineAdjust);
          newlineAdjust = 0;
        }

        this.insertLineNumber(currentLineElement, lineNumber);

        while ((current < sourceText.length) &&
          (sourceText[current] == '\n' || sourceText[current] == '\r')) {
          ++current;
          ++newlineAdjust;
        }
      }
    }
  }

  insertSourcePositions(currentSpan, lineNumber, pos, end, adjust) {
    const view = this;
    const sps = this.sourceResolver.sourcePositionsInRange(this.source.sourceId, pos - adjust, end);
    for (const sourcePosition of sps) {
      this.sourceResolver.addAnyPositionToLine(lineNumber, sourcePosition);
      const textnode = currentSpan.tagName == 'SPAN' ? currentSpan.firstChild : currentSpan;
      const replacementNode = textnode.splitText(Math.max(0, sourcePosition.scriptOffset - pos));
      const span = document.createElement('span');
      span.setAttribute("scriptOffset", sourcePosition.scriptOffset);
      span.classList.add("source-position")
      const marker = document.createElement('span');
      marker.classList.add("marker")
      span.appendChild(marker);
      const inlining = this.sourceResolver.getInliningForPosition(sourcePosition);
      if (inlining != undefined && view.showAdditionalInliningPosition) {
        const sourceName = this.sourceResolver.getSourceName(inlining.sourceId);
        const inliningMarker = document.createElement('span');
        inliningMarker.classList.add("inlining-marker")
        inliningMarker.setAttribute("data-descr", `${sourceName} was inlined here`)
        span.appendChild(inliningMarker);
      }
      span.onclick = function (e) {
        e.stopPropagation();
        view.onSelectSourcePosition(sourcePosition, !e.shiftKey)
      };
      view.addHtmlElementToSourcePosition(sourcePosition, span);
      textnode.parentNode.insertBefore(span, replacementNode);
    }
  }

  insertLineNumber(lineElement, lineNumber) {
    const view = this;
    const lineNumberElement = document.createElement("div");
    lineNumberElement.classList.add("line-number");
    lineNumberElement.dataset.lineNumber = lineNumber;
    lineNumberElement.innerText = lineNumber;
    lineNumberElement.onclick = function (e) {
      e.stopPropagation();
      view.onSelectLine(lineNumber, !e.shiftKey);
    }
    lineElement.insertBefore(lineNumberElement, lineElement.firstChild)
    // Don't add lines to source positions of not in backwardsCompatibility mode.
    if (this.source.backwardsCompatibility === true) {
      for (const sourcePosition of this.sourceResolver.linetoSourcePositions(lineNumber - 1)) {
        view.addHtmlElementToSourcePosition(sourcePosition, lineElement);
      }
    }
  }

  deleteContent() { }
  detachSelection() { return null; }
}
