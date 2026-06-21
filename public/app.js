const ACCESS_TOKEN_STORAGE_KEY = "codexPreviewAccessToken";

function loadAccessToken() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = fragment.get("token");
  if (fragmentToken) {
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, fragmentToken);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "";
}

const state = {
  accessToken: loadAccessToken(),
  conversations: [],
  filtered: [],
  activeId: null,
  activeConversation: null,
  showSupplemental: false,
  messageFontSize: Number(localStorage.getItem("codexPreviewFontSize") || 12),
};

let questionListOutsideClickHandler = null;
let anchorSelectionScrollLocked = false;
let anchorSelectionUnlockTimer = null;
let selectedAnchorTargetId = null;

function clearQuestionListOutsideClick() {
  if (!questionListOutsideClickHandler) return;
  document.removeEventListener("click", questionListOutsideClickHandler);
  questionListOutsideClickHandler = null;
}

const elements = {
  sessionsDir: document.querySelector("#sessionsDir"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  conversationList: document.querySelector("#conversationList"),
  emptyState: document.querySelector("#emptyState"),
  detailPanel: document.querySelector("#detailPanel"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  messageStream: document.querySelector("#messageStream"),
  anchorRail: document.querySelector("#anchorRail"),
  supplementalToggle: document.querySelector("#supplementalToggle"),
  decreaseFontButton: document.querySelector("#decreaseFontButton"),
  increaseFontButton: document.querySelector("#increaseFontButton"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  copyPathButton: document.querySelector("#copyPathButton"),
};

function scheduleAnchorSelectionUnlock(delay = 180) {
  clearTimeout(anchorSelectionUnlockTimer);
  anchorSelectionUnlockTimer = setTimeout(() => {
    anchorSelectionScrollLocked = false;
    anchorSelectionUnlockTimer = null;
  }, delay);
}

function syncAnchorSelection() {
  elements.anchorRail.querySelectorAll(".anchor-button").forEach((button) => {
    const selected = Boolean(selectedAnchorTargetId) && button.dataset.target === selectedAnchorTargetId;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

function syncQuestionListSelection(scrollToSelected = false) {
  let selectedItem = null;
  elements.anchorRail.querySelectorAll(".question-list-item").forEach((item) => {
    const selected = Boolean(selectedAnchorTargetId) && item.dataset.target === selectedAnchorTargetId;
    item.classList.toggle("selected", selected);
    if (selected) {
      item.setAttribute("aria-current", "true");
      selectedItem = item;
    } else {
      item.removeAttribute("aria-current");
    }
  });

  if (scrollToSelected && selectedItem) {
    requestAnimationFrame(() => selectedItem.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
}

function clearAnchorSelection() {
  selectedAnchorTargetId = null;
  syncAnchorSelection();
  syncQuestionListSelection();
}

function clearAnchorSelectionOnUserScroll() {
  anchorSelectionScrollLocked = false;
  clearTimeout(anchorSelectionUnlockTimer);
  anchorSelectionUnlockTimer = null;
  clearAnchorSelection();
}

function selectAnchor(targetId) {
  selectedAnchorTargetId = targetId;
  syncAnchorSelection();
  syncQuestionListSelection();
  anchorSelectionScrollLocked = true;
  scheduleAnchorSelectionUnlock(800);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatProcessingDuration(items) {
  if (!items.length) return "";
  const start = new Date(items[0].timestamp || "");
  const end = new Date(items.at(-1).timestamp || "");

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return formatDate(items.at(-1).timestamp);
  }

  const seconds = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function compact(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function renderInlineMarkdown(text) {
  const codeSpans = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE_SPAN_${codeSpans.length}@@`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  html = html
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');

  codeSpans.forEach((code, index) => {
    html = html.replace(`@@CODE_SPAN_${index}@@`, code);
  });

  return html;
}

function splitMarkdownTableRow(line) {
  let source = String(line || "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function tableSeparatorAlignments(line) {
  const cells = splitMarkdownTableRow(line);
  if (!cells.length) return null;

  const alignments = [];
  for (const cell of cells) {
    const marker = cell.replace(/\s/g, "");
    if (!/^:?-{3,}:?$/.test(marker)) return null;
    if (marker.startsWith(":") && marker.endsWith(":")) alignments.push("center");
    else if (marker.endsWith(":")) alignments.push("right");
    else if (marker.startsWith(":")) alignments.push("left");
    else alignments.push("");
  }
  return alignments;
}

function renderMarkdownTable(headerLine, separatorLine, rowLines) {
  const headers = splitMarkdownTableRow(headerLine);
  const alignments = tableSeparatorAlignments(separatorLine) || [];
  const columnCount = Math.max(headers.length, alignments.length);
  const renderCell = (tag, content, index) => {
    const alignment = alignments[index];
    const style = alignment ? ` style="text-align: ${alignment}"` : "";
    return `<${tag}${style}>${renderInlineMarkdown(content || "")}</${tag}>`;
  };
  const headerHtml = Array.from({ length: columnCount }, (_, index) => renderCell("th", headers[index], index)).join("");
  const bodyHtml = rowLines
    .map((rowLine) => {
      const cells = splitMarkdownTableRow(rowLine);
      return `<tr>${Array.from({ length: columnCount }, (_, index) => renderCell("td", cells[index], index)).join("")}</tr>`;
    })
    .join("");

  return `<div class="table-scroll"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function normalizeCodeLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase().replace(/[^a-z0-9_+.-]/g, "");
  if (["py", "python3", "py3"].includes(normalized)) return "python";
  return normalized;
}

function renderCodeBlock(codeLines, language) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const languageAttribute = normalizedLanguage ? ` data-language="${escapeHtml(normalizedLanguage)}"` : "";
  const languageClass = normalizedLanguage ? ` class="language-${escapeHtml(normalizedLanguage)}"` : "";
  return `<pre${languageAttribute}><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
}

function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listItems = [];
  let listType = null;
  let inCode = false;
  let codeFenceCharacter = "";
  let codeLanguage = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listItems = [];
    listType = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
    if (fence) {
      const fenceCharacter = fence[1][0];
      if (inCode && fenceCharacter === codeFenceCharacter) {
        html.push(renderCodeBlock(codeLines, codeLanguage));
        codeLines = [];
        codeLanguage = "";
        codeFenceCharacter = "";
        inCode = false;
      } else if (!inCode) {
        flushParagraph();
        flushList();
        inCode = true;
        codeFenceCharacter = fenceCharacter;
        codeLanguage = fence[2];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const alignments = index + 1 < lines.length ? tableSeparatorAlignments(lines[index + 1]) : null;
    if (line.includes("|") && alignments) {
      flushParagraph();
      flushList();
      const rowLines = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rowLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(renderMarkdownTable(line, lines[index - rowLines.length], rowLines));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) html.push(renderCodeBlock(codeLines, codeLanguage));
  flushParagraph();
  flushList();
  return html.join("\n");
}

function userQuestionText(text) {
  const marker = "My request for Codex:";
  const content = String(text || "");
  const markerIndex = content.indexOf(marker);
  const visibleContent = markerIndex === -1 ? content : content.slice(markerIndex + marker.length);
  return compact(visibleContent);
}

function userPreviewText(text) {
  return userQuestionText(text).slice(0, 180);
}

function applyMessageFontSize() {
  const size = Math.max(10, Math.min(24, state.messageFontSize));
  state.messageFontSize = size;
  document.documentElement.style.setProperty("--message-font-size", `${size}px`);
  elements.fontSizeValue.textContent = `${size}px`;
  localStorage.setItem("codexPreviewFontSize", String(size));
}

function adjustMessageFontSize(delta) {
  state.messageFontSize += delta;
  applyMessageFontSize();
}

async function fetchJson(path) {
  const headers = state.accessToken
    ? { authorization: `Bearer ${state.accessToken}` }
    : {};
  const response = await fetch(path, { headers });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("访问令牌无效，请使用服务启动时输出的访问地址重新打开页面。");
    }
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function setListStatus(message, isError = false) {
  elements.conversationList.innerHTML = `<div class="status ${isError ? "error" : ""}">${escapeHtml(message)}</div>`;
}

async function loadConversations() {
  setListStatus("正在读取本地 Codex 会话...");

  try {
    const data = await fetchJson("/api/conversations");
    state.conversations = data.conversations.filter(isVisibleConversation);
    elements.sessionsDir.textContent = `${data.sourceLabel || "本地会话"} · ${data.count} 条`;
    applyFilter();
  } catch (error) {
    elements.sessionsDir.textContent = "读取失败";
    setListStatus(error.message, true);
  }
}

function isVisibleConversation(conversation) {
  return !(
    conversation.isSubagent ||
    /(?:^| · )guardian$/.test(conversation.title || "") ||
    String(conversation.title || "").startsWith("The following is the Codex agent history")
  );
}

function applyFilter() {
  const query = compact(elements.searchInput.value).toLowerCase();

  state.filtered = state.conversations.filter((conversation) => {
    if (!query) return true;
    return [
      conversation.title,
      conversation.workspace,
      conversation.relativePath,
      conversation.id,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  renderConversationList();
}

function renderConversationList() {
  if (state.filtered.length === 0) {
    setListStatus("没有匹配的对话记录。");
    return;
  }

  elements.conversationList.innerHTML = state.filtered
    .map((conversation) => {
      const activeClass = conversation.id === state.activeId ? " active" : "";
      const errorText = conversation.loadError
        ? `<div class="meta-line error">${escapeHtml(conversation.loadError)}</div>`
        : "";

      return `
        <button class="conversation-row${activeClass}" data-id="${escapeHtml(conversation.id)}">
          <div class="conversation-title">${escapeHtml(conversation.title || conversation.id)}</div>
          <div class="conversation-path" title="${escapeHtml(conversation.relativePath)}">${escapeHtml(conversation.relativePath)}</div>
          <div class="meta-line">${escapeHtml(formatDate(conversation.updatedAt))}</div>
          <div class="count-line">
            <span>用户 ${conversation.userMessageCount}</span>
            <span>助手 ${conversation.assistantMessageCount}</span>
            <span>工具 ${conversation.toolEventCount}</span>
          </div>
          ${errorText}
        </button>
      `;
    })
    .join("");
}

async function selectConversation(id) {
  state.activeId = id;
  renderConversationList();
  elements.emptyState.classList.add("hidden");
  elements.detailPanel.classList.remove("hidden");
  elements.anchorRail.classList.remove("hidden");
  elements.detailTitle.textContent = "读取中...";
  elements.detailMeta.textContent = "";
  elements.messageStream.innerHTML = "";
  elements.anchorRail.innerHTML = "";

  try {
    const conversation = await fetchJson(`/api/conversations/${encodeURIComponent(id)}`);
    state.activeConversation = conversation;
    renderConversation(conversation);
  } catch (error) {
    elements.detailTitle.textContent = "读取失败";
    elements.messageStream.innerHTML = `<div class="status error">${escapeHtml(error.message)}</div>`;
  }
}

function renderConversation(conversation) {
  elements.detailTitle.textContent = conversation.title || conversation.id;
  elements.detailMeta.textContent = [
    formatDate(conversation.startedAt),
    conversation.workspace,
    conversation.relativePath,
  ]
    .filter(Boolean)
    .join(" · ");

  const completedTurns = getCompletedTurns(conversation.items);

  elements.messageStream.innerHTML = completedTurns
    .map((turn) => renderTurn(turn, state.showSupplemental))
    .join("");
  renderAnchorRail(buildTurnAnchors(completedTurns));
}

function isPrimaryConversationItem(item) {
  return (
    item.role === "user" ||
    (item.role === "assistant" && ["commentary", "final_answer"].includes(item.title))
  );
}

function getCompletedTurns(items) {
  const turns = [];
  let pendingTurn = null;

  for (const item of items) {
    if (item.role === "user") {
      pendingTurn = {
        user: item,
        commentary: [],
        finalAnswer: null,
        items: [item],
      };
      continue;
    }

    if (!pendingTurn) continue;
    pendingTurn.items.push(item);

    if (item.role !== "assistant" || !["commentary", "final_answer"].includes(item.title)) continue;

    if (item.title === "commentary") {
      pendingTurn.commentary.push(item);
    } else {
      pendingTurn.finalAnswer = item;
      turns.push(pendingTurn);
      pendingTurn = null;
    }
  }

  return turns;
}

function itemOrdinal(item, fallback) {
  const match = String(item?.id || "").match(/item-(\d+)/);
  return match ? Number(match[1]) : fallback;
}

function estimateFinalAnswerGap(turn) {
  const minGapPx = 34;
  const maxGapPx = 520;
  const estimatedCharsPerLine = 72;
  const estimatedLineHeight = 19;
  const contentLength = compact(turn.finalAnswer?.content || "").length;
  const estimatedLines = Math.max(1, Math.ceil(contentLength / estimatedCharsPerLine));
  return Math.min(maxGapPx, Math.max(minGapPx, Math.round(estimatedLines * estimatedLineHeight)));
}

function buildTurnAnchors(turns) {
  return turns.map((turn, index) => ({
    id: turn.user.id,
    index: index + 1,
    preview: userPreviewText(turn.user.content),
    question: userQuestionText(turn.user.content).slice(0, 300),
    timestamp: turn.user.timestamp,
    finalAnswerId: turn.finalAnswer.id,
    gapBeforePx: index === 0 ? 0 : estimateFinalAnswerGap(turns[index - 1]),
  }));
}

function buildAnchorTracks(anchors, trackHeight) {
  const topPadding = 18;
  const bottomPadding = 18;
  const minGapPx = 28;
  const usableHeight = Math.max(minGapPx, trackHeight - topPadding - bottomPadding);
  const maxAnchorsPerTrack = Math.min(15, Math.max(1, Math.floor(usableHeight / minGapPx) + 1));
  const tracks = [];

  for (let start = 0; start < anchors.length; start += maxAnchorsPerTrack) {
    tracks.push(anchors.slice(start, start + maxAnchorsPerTrack));
  }

  if (tracks.length === 1) {
    return [positionAnchorTrack(tracks[0], usableHeight, topPadding, minGapPx)];
  }

  const rowCount = Math.max(...tracks.map((track) => track.length));
  const alignedGapPx = rowCount <= 1 ? 0 : usableHeight / (rowCount - 1);
  return tracks.map((track) =>
    track.map((anchor, index) => ({
      ...anchor,
      topPx: Math.round((topPadding + index * alignedGapPx) * 100) / 100,
    })),
  );
}

function positionAnchorTrack(anchors, usableHeight, topPadding, minGapPx) {
  if (anchors.length <= 1) {
    return anchors.map((anchor) => ({ ...anchor, topPx: topPadding }));
  }

  const desiredGaps = anchors.slice(1).map((anchor) => Math.max(minGapPx, anchor.gapBeforePx));
  const desiredTotal = desiredGaps.reduce((sum, gap) => sum + gap, 0);
  const minimumTotal = minGapPx * desiredGaps.length;
  const gaps = desiredTotal <= usableHeight
    ? desiredGaps
    : compressGaps(desiredGaps, Math.max(minimumTotal, usableHeight), minGapPx);

  let top = topPadding;
  return anchors.map((anchor, index) => {
    if (index > 0) top += gaps[index - 1];
    return { ...anchor, topPx: Math.round(top * 100) / 100 };
  });
}

function compressGaps(desiredGaps, availableHeight, minGapPx) {
  const minimumTotal = minGapPx * desiredGaps.length;
  const extraBudget = Math.max(0, availableHeight - minimumTotal);
  const desiredExtras = desiredGaps.map((gap) => Math.max(0, gap - minGapPx));
  const desiredExtraTotal = desiredExtras.reduce((sum, gap) => sum + gap, 0);

  if (!desiredExtraTotal) return desiredGaps.map(() => minGapPx);
  return desiredExtras.map((extra) => minGapPx + (extra / desiredExtraTotal) * extraBudget);
}

function buildUserAnchors(items) {
  return items
    .filter((item) => item.role === "user")
    .map((item, index) => ({
      id: item.id,
      index: index + 1,
      preview: userPreviewText(item.content),
      timestamp: item.timestamp,
      top: items.length <= 1 ? 50 : Math.round((4 + (index / (items.length - 1)) * 92) * 100) / 100,
    }));
}

function renderMessage(item) {
  if (item.role === "user") return renderUserMessage(item);
  if (item.role === "assistant" && item.title === "final_answer") return renderAssistantFinalMessage(item);

  const roleClass = ["assistant", "developer", "tool", "reasoning"].includes(item.role)
    ? item.role
    : "tool";
  const label = item.title ? `${item.role} · ${item.title}` : item.role;
  const isExpandedByDefault = isPrimaryConversationItem(item);
  const openAttribute = isExpandedByDefault ? " open" : "";

  return `
    <details id="${escapeHtml(item.id)}" class="message" data-role="${escapeHtml(item.role)}"${openAttribute}>
      <summary class="message-header">
        <span class="role ${roleClass}">${escapeHtml(label)}</span>
        <span class="message-time">${escapeHtml(formatDate(item.timestamp))}</span>
      </summary>
      <div class="message-content markdown-content">${renderMarkdown(item.content)}</div>
    </details>
  `;
}

function renderChatMessageTime(item, className) {
  if (!item.timestamp) return "";
  return `<time class="chat-message-time ${className}" datetime="${escapeHtml(item.timestamp)}">${escapeHtml(formatDate(item.timestamp))}</time>`;
}

function renderAssistantFinalMessage(item) {
  return `
    <article id="${escapeHtml(item.id)}" class="message assistant-final-message" data-role="assistant">
      ${renderChatMessageTime(item, "assistant-final-time")}
      <div class="message-content markdown-content assistant-final-content">${renderMarkdown(item.content)}</div>
    </article>
  `;
}

function renderUserMessage(item) {
  return `
    <article id="${escapeHtml(item.id)}" class="message user-message" data-role="user">
      ${renderChatMessageTime(item, "user-message-time")}
      <div class="user-bubble">
        <pre class="message-content user-message-content">${escapeHtml(item.content)}</pre>
      </div>
    </article>
  `;
}

function renderTurn(turn, showSupplemental = false) {
  const thinkingItems = showSupplemental ? getThinkingItems(turn) : turn.commentary;

  return `
    ${renderMessage(turn.user)}
    ${renderCommentaryGroup(thinkingItems, turn.user.id, getThinkingItems(turn))}
    ${renderMessage(turn.finalAnswer)}
  `;
}

function getThinkingItems(turn) {
  return turn.items.filter((item) => item !== turn.user && item !== turn.finalAnswer);
}

function renderCommentaryGroup(items, userId, durationItems = items) {
  if (!items.length) return "";
  const processingDuration = formatProcessingDuration(durationItems);

  return `
    <details class="message commentary-group" data-for="${escapeHtml(userId)}">
      <summary class="message-header thinking-header" title="思考过程">
        <span class="thinking-summary">已处理${processingDuration ? ` · ${escapeHtml(processingDuration)}` : ""}</span>
      </summary>
      <div class="commentary-group-content">
        ${items.map(renderThinkingEntry).join("")}
      </div>
    </details>
  `;
}

function renderThinkingEntry(item) {
  if (item.role === "assistant" && item.title === "commentary") return renderCommentaryEntry(item);
  return renderThinkingSupplementalEntry(item);
}

function renderThinkingSupplementalEntry(item) {
  const label = item.title ? `${item.role} · ${item.title}` : item.role;

  return `
    <section class="commentary-entry supplemental-entry">
      <div class="message-time">${escapeHtml(label)} · ${escapeHtml(formatDate(item.timestamp))}</div>
      <div class="message-content markdown-content">${renderMarkdown(item.content)}</div>
    </section>
  `;
}

function renderCommentaryEntry(item) {
  return `
    <section class="commentary-entry">
      <div class="message-time">${escapeHtml(formatDate(item.timestamp))}</div>
      <div class="message-content markdown-content">${renderMarkdown(item.content)}</div>
    </section>
  `;
}

function scrollToUserMessage(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return false;

  if (target.tagName.toLowerCase() === "details") {
    target.open = true;
  }
  selectAnchor(targetId);
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  target.classList.add("highlight");
  setTimeout(() => target.classList.remove("highlight"), 1400);
  return true;
}

function renderAnchorRail(anchors) {
  clearQuestionListOutsideClick();

  if (!anchors.length) {
    elements.anchorRail.innerHTML = `<div class="rail-header"><div class="rail-title">无用户消息</div></div>`;
    return;
  }

  const trackHeight = Math.max(120, elements.anchorRail.clientHeight - 72);
  const tracks = buildAnchorTracks(anchors, trackHeight);
  const availableWidth = Math.max(24, elements.anchorRail.clientWidth - 20);
  const trackWidth = Math.max(18, Math.min(28, Math.floor(availableWidth / Math.max(1, tracks.length))));

  elements.anchorRail.innerHTML = `
    <div class="rail-header">
      <button class="question-list-toggle" type="button" aria-label="打开提问列表" aria-expanded="false" title="提问列表">
        <span></span><span></span><span></span>
      </button>
      <div class="rail-title">用户消息定位</div>
    </div>
    <div class="anchor-track-grid" style="--track-height: ${trackHeight}px; --track-width: ${trackWidth}px">
      ${tracks
        .map(
          (track) => `
            <div class="anchor-track">
              ${track
                .map(
                  (anchor) => `
                    <button class="anchor-button" style="--anchor-top: ${anchor.topPx}px" data-target="${escapeHtml(anchor.id)}" data-preview="${escapeHtml(anchor.preview)}" aria-label="用户消息 ${anchor.index}"></button>
                  `,
                )
                .join("")}
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="anchor-floating-preview" aria-hidden="true"></div>
    <div class="question-list-popover" aria-hidden="true">
      <div class="question-list-title">提问列表（${anchors.length}）</div>
      <div class="question-list-items">
        ${anchors
          .map(
            (anchor) => `
              <button class="question-list-item" type="button" data-target="${escapeHtml(anchor.id)}">
                <span class="question-list-index">${anchor.index}</span>
                <span class="question-list-text">${escapeHtml(anchor.question || anchor.preview || "空消息")}</span>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;

  if (selectedAnchorTargetId && !anchors.some((anchor) => anchor.id === selectedAnchorTargetId)) {
    selectedAnchorTargetId = null;
  }
  syncAnchorSelection();
  syncQuestionListSelection();

  const floatingPreview = elements.anchorRail.querySelector(".anchor-floating-preview");
  const questionListToggle = elements.anchorRail.querySelector(".question-list-toggle");
  const questionList = elements.anchorRail.querySelector(".question-list-popover");
  const closeQuestionList = () => {
    clearQuestionListOutsideClick();
    questionList.classList.remove("visible");
    questionList.setAttribute("aria-hidden", "true");
    questionListToggle.setAttribute("aria-expanded", "false");
  };

  questionListToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    floatingPreview.classList.remove("visible");
    const willOpen = !questionList.classList.contains("visible");
    if (!willOpen) {
      closeQuestionList();
      return;
    }

    const rect = questionListToggle.getBoundingClientRect();
    questionList.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 420))}px`;
    questionList.classList.add("visible");
    questionList.setAttribute("aria-hidden", "false");
    questionListToggle.setAttribute("aria-expanded", "true");
    syncQuestionListSelection(true);
    questionListOutsideClickHandler = (outsideEvent) => {
      if (questionList.contains(outsideEvent.target) || questionListToggle.contains(outsideEvent.target)) return;
      closeQuestionList();
    };
    document.addEventListener("click", questionListOutsideClickHandler);
  });

  questionList.addEventListener("click", (event) => {
    event.stopPropagation();
    const item = event.target.closest(".question-list-item");
    if (!item) return;
    if (scrollToUserMessage(item.dataset.target)) {
      closeQuestionList();
      questionListToggle.blur();
    }
  });

  questionListToggle.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeQuestionList();
  });
  questionList.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeQuestionList();
      questionListToggle.focus();
    }
  });

  elements.anchorRail.querySelectorAll(".anchor-button").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      button.classList.remove("preview-dismissed");
      const rect = button.getBoundingClientRect();
      floatingPreview.textContent = button.dataset.preview || "";
      floatingPreview.style.top = `${Math.max(12, Math.min(rect.top + rect.height / 2 - 18, window.innerHeight - 240))}px`;
      floatingPreview.classList.add("visible");
    });

    button.addEventListener("mouseleave", () => {
      button.classList.remove("preview-dismissed");
      floatingPreview.classList.remove("visible");
    });

    button.addEventListener("click", () => {
      button.classList.add("preview-dismissed");
      floatingPreview.classList.remove("visible");
      closeQuestionList();
      button.blur();
      scrollToUserMessage(button.dataset.target);
    });
  });
}

elements.conversationList.addEventListener("click", (event) => {
  const row = event.target.closest(".conversation-row");
  if (!row) return;
  selectConversation(row.dataset.id);
});

elements.messageStream.addEventListener("scroll", () => {
  if (anchorSelectionScrollLocked) {
    scheduleAnchorSelectionUnlock();
    return;
  }
  clearAnchorSelection();
});
elements.messageStream.addEventListener("wheel", clearAnchorSelectionOnUserScroll, { passive: true });
elements.messageStream.addEventListener("touchmove", clearAnchorSelectionOnUserScroll, { passive: true });

elements.searchInput.addEventListener("input", applyFilter);
elements.refreshButton.addEventListener("click", loadConversations);
elements.decreaseFontButton.addEventListener("click", () => adjustMessageFontSize(-1));
elements.increaseFontButton.addEventListener("click", () => adjustMessageFontSize(1));
elements.supplementalToggle.addEventListener("change", () => {
  state.showSupplemental = elements.supplementalToggle.checked;
  if (state.activeConversation) {
    renderConversation(state.activeConversation);
  }
});
elements.copyPathButton.addEventListener("click", async () => {
  if (!state.activeConversation) return;

  try {
    const data = await fetchJson(`/api/conversations/${encodeURIComponent(state.activeConversation.id)}/path`);
    await navigator.clipboard.writeText(data.filePath);
    elements.copyPathButton.textContent = "已复制";
    setTimeout(() => {
      elements.copyPathButton.textContent = "复制路径";
    }, 1200);
  } catch {
    elements.copyPathButton.textContent = "复制失败";
    setTimeout(() => {
      elements.copyPathButton.textContent = "复制路径";
    }, 1200);
  }
});

applyMessageFontSize();
loadConversations();
