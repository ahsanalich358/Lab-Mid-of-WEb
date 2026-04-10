"use strict";

/* =============================================
   CONFIG
   ============================================= */
const GEMINI_KEY = "AIzaSyBCwEYmVeqUu8kbUgCjZtMM1gE9fpDoT9k";

// Models to try in order — auto-discovered ones will be prepended
const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash"
];

let modelList = [...FALLBACK_MODELS];

function apiUrl(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/"
    + model + ":generateContent?key=" + GEMINI_KEY;
}

/* =============================================
   STATE
   ============================================= */
let currentIdeas  = [];
let savedIdeas    = JSON.parse(localStorage.getItem("ig_saved")   || "[]");
let history       = JSON.parse(localStorage.getItem("ig_history") || "[]");

/* =============================================
   PAGE NAVIGATION
   ============================================= */
function showPage(id) {
  document.querySelectorAll(".page").forEach(function(p) {
    p.classList.remove("active");
  });
  var target = document.getElementById(id);
  if (target) { target.classList.add("active"); }
  window.scrollTo(0, 0);
  updateBadge();
  if (id === "page-saved") { renderSavedPage(); }
}

/* =============================================
   MODEL DISCOVERY
   ============================================= */
function discoverModels() {
  fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + GEMINI_KEY)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.models) return;
      var found = [];
      data.models.forEach(function(m) {
        var methods = m.supportedGenerationMethods || [];
        if (methods.indexOf("generateContent") === -1) return;
        var name = m.name.replace("models/", "");
        if (name.indexOf("gemini") === -1) return;
        if (name.indexOf("embed") !== -1) return;
        if (name.indexOf("aqa") !== -1) return;
        found.push(name);
      });
      // flash first, then others
      found.sort(function(a, b) {
        var sa = a.indexOf("flash") !== -1 ? 0 : 1;
        var sb = b.indexOf("flash") !== -1 ? 0 : 1;
        return sa - sb;
      });
      if (found.length) {
        modelList = found;
        console.log("Available models:", modelList);
      }
    })
    .catch(function(e) {
      console.log("Discovery failed, using defaults:", e.message);
    });
}

/* =============================================
   GENERATE IDEAS
   ============================================= */
function generateIdeas() {
  var topic    = document.getElementById("topicInput").value.trim();
  var format   = document.getElementById("formatSelect").value;
  var audience = document.getElementById("audienceInput").value.trim() || "general audience";
  var tone     = document.getElementById("toneSelect").value;
  var count    = parseInt(document.getElementById("countSelect").value) || 5;

  if (!topic) {
    showToast("Please enter a topic!", "warn");
    document.getElementById("topicInput").focus();
    return;
  }

  setLoading(true);

  var prompt = "You are a creative content strategist.\n"
    + "Generate exactly " + count + " unique " + format + " content ideas for the niche: \"" + topic + "\".\n"
    + "Target audience: " + audience + "\n"
    + "Tone: " + tone + "\n\n"
    + "IMPORTANT: Reply ONLY with a valid JSON array. No markdown, no backticks, no extra text.\n\n"
    + "Use this exact structure:\n"
    + "[\n"
    + "  {\n"
    + "    \"title\": \"Specific idea title\",\n"
    + "    \"description\": \"2 sentences about the idea.\",\n"
    + "    \"tags\": [\"tag1\", \"tag2\", \"tag3\"],\n"
    + "    \"hook\": \"One punchy opening line\"\n"
    + "  }\n"
    + "]\n\n"
    + "Make every idea distinct and specific. No generic ideas.";

  var body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
  });

  tryNextModel(modelList, 0, body, topic, format);
}

function tryNextModel(models, index, body, topic, format) {
  if (index >= models.length) {
    setLoading(false);
    showToast("All models failed. Check your API key and internet.", "error");
    return;
  }

  var model = models[index];
  console.log("Trying: " + model);

  fetch(apiUrl(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    // API returned an error object
    if (data.error) {
      console.warn(model + " error:", data.error.message);
      tryNextModel(models, index + 1, body, topic, format);
      return;
    }

    var raw = "";
    try {
      raw = data.candidates[0].content.parts[0].text;
    } catch(e) {
      console.warn(model + ": unexpected response shape");
      tryNextModel(models, index + 1, body, topic, format);
      return;
    }

    // Strip any markdown fences
    var clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    try {
      currentIdeas = JSON.parse(clean);
    } catch(e) {
      // Try to extract JSON array from response
      var match = clean.match(/\[[\s\S]*\]/);
      if (match) {
        try { currentIdeas = JSON.parse(match[0]); }
        catch(e2) {
          console.warn(model + ": JSON parse failed");
          tryNextModel(models, index + 1, body, topic, format);
          return;
        }
      } else {
        console.warn(model + ": no JSON array found");
        tryNextModel(models, index + 1, body, topic, format);
        return;
      }
    }

    // Success!
    setLoading(false);
    renderIdeas(topic, format);
    addHistory(topic);
    showToast("Generated " + currentIdeas.length + " ideas!", "success");
  })
  .catch(function(err) {
    console.warn(model + " fetch error:", err.message);
    tryNextModel(models, index + 1, body, topic, format);
  });
}

/* =============================================
   LOADING STATE
   ============================================= */
function setLoading(on) {
  var btn    = document.getElementById("genBtn");
  var text   = document.getElementById("btnText");
  var loader = document.getElementById("btnLoader");
  btn.disabled = on;
  text.style.display   = on ? "none" : "";
  loader.style.display = on ? "inline-flex" : "none";
}

/* =============================================
   RENDER IDEAS
   ============================================= */
function renderIdeas(topic, format) {
  var grid    = document.getElementById("ideasGrid");
  var empty   = document.getElementById("emptyState");
  var bar     = document.getElementById("actionBar");
  var label   = document.getElementById("actionLabel");

  empty.style.display = "none";
  bar.style.display   = "flex";
  label.textContent   = currentIdeas.length + " Ideas · " + topic + " · " + format;
  grid.innerHTML      = "";

  currentIdeas.forEach(function(idea, i) {
    var isSaved = savedIdeas.some(function(s) { return s.title === idea.title; });
    var tags = (idea.tags || []).map(function(t) {
      return '<span class="card-tag">' + esc(t) + '</span>';
    }).join("");

    var card = document.createElement("div");
    card.className = "idea-card";
    card.style.animationDelay = (i * 0.07) + "s";
    card.innerHTML =
      '<div class="card-row">'
        + '<span class="card-num">Idea ' + String(i+1).padStart(2,"0") + '</span>'
        + '<div class="card-title">' + esc(idea.title) + '</div>'
        + '<button class="star-btn ' + (isSaved ? "starred" : "") + '" onclick="toggleSave(' + i + ', this)">'
          + (isSaved ? "★" : "☆")
        + '</button>'
      + '</div>'
      + (idea.hook ? '<div class="card-hook">&ldquo;' + esc(idea.hook) + '&rdquo;</div>' : "")
      + '<div class="card-desc">' + esc(idea.description) + '</div>'
      + '<div class="card-footer">'
        + '<div class="card-tags">' + tags + '</div>'
        + '<button class="copy-btn" onclick="copyIdea(' + i + ')">'
          + '<i class="bi bi-clipboard"></i> Copy'
        + '</button>'
      + '</div>';

    grid.appendChild(card);
  });

  renderHistory();
}

/* =============================================
   SAVE / STAR
   ============================================= */
function toggleSave(index, btn) {
  var idea = currentIdeas[index];
  var pos  = savedIdeas.findIndex(function(s) { return s.title === idea.title; });

  if (pos > -1) {
    savedIdeas.splice(pos, 1);
    btn.textContent = "☆";
    btn.classList.remove("starred");
    showToast("Removed from saved.", "info");
  } else {
    savedIdeas.push(Object.assign({}, idea, { savedAt: Date.now() }));
    btn.textContent = "★";
    btn.classList.add("starred");
    showToast("Idea saved!", "success");
  }

  localStorage.setItem("ig_saved", JSON.stringify(savedIdeas));
  updateBadge();
}

function updateBadge() {
  var badges = document.querySelectorAll("#savedCountBadge");
  badges.forEach(function(b) { b.textContent = savedIdeas.length; });
}

/* =============================================
   SAVED PAGE
   ============================================= */
function renderSavedPage() {
  var grid    = document.getElementById("savedGrid");
  var empty   = document.getElementById("savedEmptyState");
  var filter  = document.getElementById("savedFilterBar");
  var sfCount = document.getElementById("sfCount");
  var search  = (document.getElementById("savedSearchInput") || {}).value || "";
  search = search.toLowerCase();

  var filtered = savedIdeas.filter(function(idea) {
    return idea.title.toLowerCase().indexOf(search) !== -1
      || idea.description.toLowerCase().indexOf(search) !== -1;
  });

  if (!savedIdeas.length) {
    empty.style.display  = "";
    filter.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  empty.style.display  = "none";
  filter.style.display = "flex";
  sfCount.textContent  = filtered.length + " / " + savedIdeas.length;
  grid.innerHTML = "";

  filtered.forEach(function(idea, i) {
    var tags = (idea.tags || []).map(function(t) {
      return '<span class="card-tag">' + esc(t) + '</span>';
    }).join("");

    var card = document.createElement("div");
    card.className = "idea-card";
    card.style.animationDelay = (i * 0.06) + "s";
    card.innerHTML =
      '<div class="card-row">'
        + '<span class="card-num">Saved ' + String(i+1).padStart(2,"0") + '</span>'
        + '<div class="card-title">' + esc(idea.title) + '</div>'
        + '<button class="star-btn starred" onclick="removeSaved(' + JSON.stringify(idea.title) + ', this)">★</button>'
      + '</div>'
      + '<div class="card-desc">' + esc(idea.description) + '</div>'
      + '<div class="card-footer">'
        + '<div class="card-tags">' + tags + '</div>'
        + '<button class="copy-btn" onclick="copyText(\'' + escAttr(idea.title + ': ' + idea.description) + '\')">'
          + '<i class="bi bi-clipboard"></i> Copy'
        + '</button>'
      + '</div>';

    grid.appendChild(card);
  });
}

function removeSaved(title) {
  savedIdeas = savedIdeas.filter(function(s) { return s.title !== title; });
  localStorage.setItem("ig_saved", JSON.stringify(savedIdeas));
  updateBadge();
  renderSavedPage();
  showToast("Removed from saved.", "info");
}

function clearAllSaved() {
  if (!savedIdeas.length) { showToast("Nothing to clear.", "info"); return; }
  if (confirm("Clear all saved ideas? This cannot be undone.")) {
    savedIdeas = [];
    localStorage.setItem("ig_saved", JSON.stringify(savedIdeas));
    updateBadge();
    renderSavedPage();
    showToast("All saved ideas cleared.", "info");
  }
}

/* =============================================
   COPY
   ============================================= */
function copyIdea(index) {
  var idea = currentIdeas[index];
  copyText(idea.title + "\n\n" + idea.description + "\nTags: " + (idea.tags||[]).join(", "));
}

function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(function() { showToast("Copied to clipboard!", "success"); })
    .catch(function() { showToast("Copy failed.", "error"); });
}

/* =============================================
   DOWNLOAD
   ============================================= */
function downloadTXT() {
  if (!currentIdeas.length) { showToast("No ideas yet.", "warn"); return; }
  var topic  = document.getElementById("topicInput").value.trim();
  var format = document.getElementById("formatSelect").value;
  var out = "CONTENT IDEAS — " + topic.toUpperCase() + " (" + format + ")\n";
  out += "Generated: " + new Date().toLocaleString() + "\n";
  out += "=".repeat(48) + "\n\n";
  currentIdeas.forEach(function(idea, i) {
    out += (i+1) + ". " + idea.title + "\n";
    if (idea.hook) out += "   Hook: \"" + idea.hook + "\"\n";
    out += "   " + idea.description + "\n";
    out += "   Tags: " + (idea.tags||[]).join(", ") + "\n\n";
  });
  out += "=".repeat(48) + "\nGenerated by IdeaSpark · Powered by Google Gemini AI";
  triggerDownload(out, "ideas-" + slug(topic) + ".txt", "text/plain");
  showToast("Downloaded .txt!", "success");
}

function downloadJSON() {
  if (!currentIdeas.length) { showToast("No ideas yet.", "warn"); return; }
  var topic  = document.getElementById("topicInput").value.trim();
  var format = document.getElementById("formatSelect").value;
  var payload = {
    meta: { tool:"IdeaSpark", poweredBy:"Google Gemini AI", topic:topic, format:format, generatedAt:new Date().toISOString() },
    ideas: currentIdeas
  };
  triggerDownload(JSON.stringify(payload, null, 2), "ideas-" + slug(topic) + ".json", "application/json");
  showToast("Downloaded .json!", "success");
}

function triggerDownload(content, filename, type) {
  var blob = new Blob([content], { type: type });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =============================================
   SHARE MODAL
   ============================================= */
function buildShareText() {
  if (!currentIdeas.length) return "";
  var topic  = document.getElementById("topicInput").value.trim();
  var format = document.getElementById("formatSelect").value;
  var t = "✦ " + currentIdeas.length + " Content Ideas for \"" + topic + "\" (" + format + ")\n\n";
  currentIdeas.forEach(function(idea, i) { t += (i+1) + ". " + idea.title + "\n"; });
  t += "\n✨ Generated with IdeaSpark · Powered by Google Gemini AI";
  return t;
}

function openShareModal() {
  if (!currentIdeas.length) { showToast("Generate ideas first!", "warn"); return; }
  document.getElementById("shareTextBox").textContent = buildShareText();
  document.getElementById("shareModal").classList.add("open");
}
function closeShareModal() { document.getElementById("shareModal").classList.remove("open"); }
function overlayClick(e) { if (e.target === e.currentTarget) closeShareModal(); }

function copyShareText() {
  navigator.clipboard.writeText(buildShareText()).then(function() {
    showToast("Copied!", "success"); closeShareModal();
  });
}
function shareWhatsApp() {
  window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(buildShareText()));
  closeShareModal();
}
function shareEmail() {
  var topic = document.getElementById("topicInput").value.trim();
  window.open("mailto:?subject=" + encodeURIComponent("Content Ideas for " + topic)
    + "&body=" + encodeURIComponent(buildShareText()));
  closeShareModal();
}
function shareTwitter() {
  var text = "✦ Content ideas by IdeaSpark:\n";
  currentIdeas.slice(0,2).forEach(function(idea, i) { text += (i+1) + ". " + idea.title + "\n"; });
  text += "\n#ContentCreator #ContentIdeas";
  window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text));
  closeShareModal();
}

/* =============================================
   HISTORY
   ============================================= */
function addHistory(topic) {
  history = [topic].concat(history.filter(function(h) { return h !== topic; })).slice(0, 8);
  localStorage.setItem("ig_history", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  var strip = document.getElementById("historyStrip");
  var chips = document.getElementById("historyChips");
  if (!history.length || !strip) return;
  strip.style.display = "flex";
  chips.innerHTML = history.map(function(h) {
    return '<button class="hist-chip" onclick="useHistory(\'' + escAttr(h) + '\')">' + esc(h) + '</button>';
  }).join("");
}

function useHistory(topic) {
  document.getElementById("topicInput").value = topic;
  showToast("Topic set: " + topic, "info");
}

/* =============================================
   TOAST
   ============================================= */
function showToast(msg, type) {
  var wrap  = document.getElementById("toastWrap");
  var icons = { success:"✦", warn:"⚠", error:"✕", info:"ℹ" };
  var toast = document.createElement("div");
  toast.className = "toast-item";
  toast.textContent = (icons[type] || "ℹ") + " " + msg;
  wrap.appendChild(toast);
  setTimeout(function() {
    toast.style.transition = "opacity .4s, transform .4s";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(28px)";
    setTimeout(function() { toast.remove(); }, 400);
  }, 2800);
}

/* =============================================
   HELPERS
   ============================================= */
function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
function escAttr(str) {
  return String(str || "").replace(/'/g,"\\'").replace(/\n/g," ");
}
function slug(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

/* =============================================
   INIT
   ============================================= */
document.addEventListener("DOMContentLoaded", function() {
  discoverModels();
  updateBadge();
  renderHistory();

  var input = document.getElementById("topicInput");
  if (input) {
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") generateIdeas();
    });
  }
});