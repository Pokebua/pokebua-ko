const $ = id => document.getElementById(id);
const socket = io();

const state = {
  current: null,
  queue: [],
  currentStartedAt:
    Number(sessionStorage.getItem("pxCurrentStartedAt")) || 0,
  lastCurrentId:
    sessionStorage.getItem("pxCurrentId") || null,
  finished:
    Number(sessionStorage.getItem("pxFinished")) || 0,
  selectedId: null,
  activities: JSON.parse(
    sessionStorage.getItem("pxActivities") || "[]"
  )
};

const settings = Object.assign(
  {
    confirmFinish: true,
    sounds: true,
    showBoot: true
  },
  JSON.parse(localStorage.getItem("pxSettings") || "{}")
);

const pageInfo = {
  dashboard: ["CONTROL CENTER", "Dashboard"],
  queue: ["SMART QUEUE", "Kø"],
  giveaway: ["EVENT CONTROL", "Giveaways"],
  overlay: ["STREAM OUTPUT", "Overlay"],
  soundboard: ["AUDIO CONTROL", "Soundboard"],
  analytics: ["SESSION DATA", "Analytics"],
  settings: ["SYSTEM", "Innstillinger"]
};

/* =========================================================
   GENERELLE HJELPEFUNKSJONER
========================================================= */

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[character];
  });
}

function firstName(value = "") {
  return String(value).trim().split(/\s+/)[0] || "Kunde";
}

function cleanTwitch(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .trim();
}

function safeDisplayName(entry = {}) {
  const twitch = cleanTwitch(
    entry.twitchName ||
    entry.twitch ||
    entry.streamName ||
    ""
  );

  return (
    twitch ||
    firstName(
      entry.displayName ||
      entry.name ||
      "Kunde"
    )
  );
}

function isQueueClosedEntry(entry = {}) {
  return (
    entry.system === true &&
    entry.type === "queue-closed"
  );
}

function getCustomerQueue() {
  return state.queue.filter(
    entry => !isQueueClosedEntry(entry)
  );
}

function getCustomerPosition(entry) {
  const customers = getCustomerQueue();

  return customers.findIndex(
    customer =>
      String(customer.id) === String(entry.id)
  );
}

function formatAge(createdAt) {
  if (!createdAt) {
    return "nå";
  }

  const createdTime = new Date(createdAt).getTime();

  if (!Number.isFinite(createdTime)) {
    return "nå";
  }

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - createdTime) / 60000)
  );

  if (minutes < 1) {
    return "nå";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  return `${Math.floor(minutes / 60)}t ${minutes % 60}m`;
}

function api(url, options = {}) {
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  }).then(async response => {
    if (!response.ok) {
      const result = await response
        .json()
        .catch(() => ({}));

      throw new Error(
        result.error || `Feil ${response.status}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  });
}

function post(url, body) {
  return api(url, {
    method: "POST",
    body: body
      ? JSON.stringify(body)
      : undefined
  });
}

/* =========================================================
   INNSTILLINGER OG NAVIGASJON
========================================================= */

function saveSettings() {
  settings.confirmFinish =
    $("confirmFinish").checked;

  settings.sounds =
    $("studioSounds").checked;

  settings.showBoot =
    $("showBoot").checked;

  localStorage.setItem(
    "pxSettings",
    JSON.stringify(settings)
  );
}

function switchView(name) {
  if (!pageInfo[name]) {
    return;
  }

  document
    .querySelectorAll(".view")
    .forEach(view => {
      view.classList.toggle(
        "active",
        view.id === `view-${name}`
      );
    });

  document
    .querySelectorAll(".nav-item")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === name
      );
    });

  $("pageEyebrow").textContent =
    pageInfo[name][0];

  $("pageTitle").textContent =
    pageInfo[name][1];

  $("sidebar").classList.remove("open");
}

/* =========================================================
   VARSLER OG AKTIVITET
========================================================= */

function toast(title, detail = "") {
  const item = document.createElement("div");
  item.className = "toast";

  item.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    ${
      detail
        ? `<small>${escapeHtml(detail)}</small>`
        : ""
    }
  `;

  $("toastHost").append(item);

  setTimeout(() => {
    item.remove();
  }, 3600);
}

function addActivity(text, icon = "●") {
  state.activities.unshift({
    text,
    icon,
    time: new Date().toISOString()
  });

  state.activities =
    state.activities.slice(0, 80);

  sessionStorage.setItem(
    "pxActivities",
    JSON.stringify(state.activities)
  );

  renderActivity();
}

function renderActivity() {
  const activityFeed = $("activityFeed");

  activityFeed.classList.toggle(
    "empty-state",
    !state.activities.length
  );

  if (!state.activities.length) {
    activityFeed.innerHTML =
      "Ingen aktivitet ennå.";

    return;
  }

  activityFeed.innerHTML =
    state.activities
      .map(activity => {
        const time = new Date(
          activity.time
        ).toLocaleTimeString("no-NO", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

        return `
          <div class="activity-item">
            <b>${escapeHtml(activity.icon)}</b>

            <div>
              <strong>
                ${escapeHtml(activity.text)}
              </strong>

              <small>${time}</small>
            </div>
          </div>
        `;
      })
      .join("");
}

/* =========================================================
   LYDER
========================================================= */

function playSound(type) {
  if (!settings.sounds) {
    return;
  }

  const AudioContextClass =
    window.AudioContext ||
    window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();

  const tones = {
    order: [520, 690],
    skip: [740, 980],
    giveaway: [440, 660, 880],
    finish: [620]
  }[type] || [520];

  tones.forEach((frequency, index) => {
    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    const startTime =
      context.currentTime + index * 0.09;

    oscillator.frequency.value =
      frequency;

    oscillator.type = "sine";

    gain.gain.setValueAtTime(
      0.0001,
      startTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.08,
      startTime + 0.015
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + 0.18
    );

    oscillator
      .connect(gain)
      .connect(context.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);
  });
}

/* =========================================================
   KØKORT
========================================================= */

function queueCard(entry, index, compact = false) {
  if (isQueueClosedEntry(entry)) {
    return `
      <article
        class="queue-card queue-closed-card"
        data-id="${entry.id}"
        data-system-card="queue-closed"
      >
        <div class="queue-main">
          <div class="queue-title">
            <span class="queue-position">⛔</span>

            <strong>KØ STENGT</strong>
          </div>

          <div class="queue-meta">
            ${escapeHtml(
              entry.items ||
              "Ingen flere bestillinger i kveld"
            )}
          </div>

          <div class="tags">
            <span class="tag queue-closed-tag">
              Ingen nye bestillinger
            </span>
          </div>
        </div>
      </article>
    `;
  }

  const name = safeDisplayName(entry);

  const priority =
    entry.skipTheLine ||
    entry.priority;

  let classes = "";

  if (priority) {
    classes = "priority";
  } else if (entry.giveaway) {
    classes = "giveaway";
  }

  const metadata = [
    entry.order,
    entry.items
  ]
    .filter(Boolean)
    .join(" • ");

  return `
    <article
      class="queue-card ${classes}"
      draggable="true"
      data-id="${entry.id}"
    >
      <div class="queue-main">
        <div class="queue-title">
          <span class="queue-position">
            ${index + 1}
          </span>

          <strong>
            ${
              priority
                ? "⚡ "
                : entry.giveaway
                  ? "✦ "
                  : ""
            }${escapeHtml(name)}
          </strong>
        </div>

        <div class="queue-meta">
          ${escapeHtml(metadata)}

          ${
            entry.createdAt
              ? ` · ⏱ ${formatAge(entry.createdAt)}`
              : ""
          }
        </div>

        <div class="tags">
          ${
            priority
              ? `
                <span class="tag skip">
                  Skip the Line
                </span>
              `
              : ""
          }

          ${
            entry.giveaway
              ? `
                <span class="tag give">
                  Giveaway
                </span>
              `
              : ""
          }
        </div>
      </div>

      <div class="queue-actions">
        <button
          class="small-button"
          data-action="open"
        >
          ▶ Åpne
        </button>

        ${
          compact
            ? ""
            : `
              <button
                class="small-button"
                data-action="top"
              >
                Topp
              </button>

              <button
                class="small-button"
                data-action="skip"
              >
                ⚡ Skip
              </button>

              <button
                class="small-button"
                data-action="delete"
              >
                Fjern
              </button>
            `
        }
      </div>
    </article>
  `;
}

/* =========================================================
   FILTRERING OG VISNING AV KØ
========================================================= */

function filteredQueue() {
  const query = $("queueSearch")
    .value
    .trim()
    .toLowerCase();

  const filter =
    $("queueFilter").value;

  return state.queue.filter(entry => {
    if (isQueueClosedEntry(entry)) {
      return (
        filter === "all" &&
        !query
      );
    }

    const searchText = `
      ${safeDisplayName(entry)}
      ${entry.order || ""}
      ${entry.items || ""}
    `.toLowerCase();

    const skipTheLine =
      entry.skipTheLine ||
      entry.priority;

    const matchesQuery =
      searchText.includes(query);

    const matchesFilter =
      filter === "all" ||
      (
        filter === "skip" &&
        skipTheLine
      ) ||
      (
        filter === "giveaway" &&
        entry.giveaway
      ) ||
      (
        filter === "normal" &&
        !skipTheLine &&
        !entry.giveaway
      );

    return (
      matchesQuery &&
      matchesFilter
    );
  });
}

function renderQueueLists() {
  const customers = getCustomerQueue();

  const dashboardEntries =
    state.queue.slice(0, 10);

  if (dashboardEntries.length) {
    $("dashboardQueue").innerHTML =
      dashboardEntries
        .map(entry => {
          const position =
            getCustomerPosition(entry);

          return queueCard(
            entry,
            Math.max(0, position),
            true
          );
        })
        .join("");
  } else {
    $("dashboardQueue").innerHTML =
      '<div class="empty-state">Køen er tom.</div>';
  }

  const fullQueue =
    filteredQueue();

  if (fullQueue.length) {
    $("fullQueue").innerHTML =
      fullQueue
        .map(entry => {
          const position =
            getCustomerPosition(entry);

          return queueCard(
            entry,
            Math.max(0, position)
          );
        })
        .join("");
  } else {
    $("fullQueue").innerHTML =
      '<div class="empty-state">Ingen ordre matcher.</div>';
  }

  $("queueCount").textContent =
    `${customers.length} ${
      customers.length === 1
        ? "ordre"
        : "ordrer"
    } i kø`;

  const giveaways =
    customers.filter(
      entry => entry.giveaway
    );

  if (giveaways.length) {
    $("giveawayList").innerHTML =
      giveaways
        .map(entry =>
          queueCard(
            entry,
            getCustomerPosition(entry),
            true
          )
        )
        .join("");
  } else {
    $("giveawayList").innerHTML =
      '<div class="empty-state">Ingen aktive giveaways.</div>';
  }

  bindDragAndDrop();
}

/* =========================================================
   TALL OG DASHBOARD
========================================================= */

function animateNumber(id, target) {
  const element = $(id);

  if (!element) {
    return;
  }

  const start =
    Number(element.textContent) || 0;

  const difference =
    target - start;

  const startTime =
    performance.now();

  function tick(time) {
    const progress = Math.min(
      1,
      (time - startTime) / 260
    );

    element.textContent =
      Math.round(
        start +
        difference *
        (
          1 -
          Math.pow(1 - progress, 3)
        )
      );

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

function renderMiniQueue(customers) {
  const previewEntries =
    state.queue.slice(0, 5);

  const miniQueue =
    $("miniQueue");

  miniQueue.classList.toggle(
    "empty-state",
    !previewEntries.length
  );

  if (!previewEntries.length) {
    miniQueue.innerHTML =
      "Køen er tom.";

    return;
  }

  miniQueue.innerHTML =
    previewEntries
      .map(entry => {
        if (isQueueClosedEntry(entry)) {
          return `
            <div class="mini-row mini-closed-row">
              <b>⛔</b>

              <div>
                <strong>KØ STENGT</strong>

                <small>
                  Ingen flere bestillinger
                </small>
              </div>
            </div>
          `;
        }

        const position =
          customers.findIndex(
            customer =>
              String(customer.id) ===
              String(entry.id)
          );

        return `
          <div class="mini-row">
            <b>${position + 1}</b>

            <div>
              <strong>
                ${escapeHtml(
                  safeDisplayName(entry)
                )}
              </strong>

              <small>
                ${escapeHtml(
                  [
                    entry.order,
                    entry.items
                  ]
                    .filter(Boolean)
                    .join(" • ")
                )}
              </small>
            </div>
          </div>
        `;
      })
      .join("");
}

function render() {
  const customers =
    getCustomerQueue();

  const currentName =
    state.current
      ? safeDisplayName(state.current)
      : "Ingen aktiv ordre";

  $("heroName").textContent =
    currentName;

  $("heroMeta").textContent =
    state.current
      ? [
          state.current.order,
          state.current.items
        ]
          .filter(Boolean)
          .join("\n")
      : "Start neste kunde når du er klar.";

  $("heroCard").classList.toggle(
    "has-current",
    Boolean(state.current)
  );

  renderMiniQueue(customers);

  const skipCount =
    customers.filter(
      entry =>
        entry.skipTheLine ||
        entry.priority
    ).length;

  const giveawayCount =
    customers.filter(
      entry => entry.giveaway
    ).length;

  animateNumber(
    "statQueue",
    customers.length
  );

  animateNumber(
    "statSkip",
    skipCount
  );

  animateNumber(
    "statGive",
    giveawayCount
  );

  $("queueBadge").textContent =
    customers.length;

  $("previewCount").textContent =
    customers.length;

  animateNumber(
    "analyticsOrders",
    customers.length +
    (state.current ? 1 : 0) +
    state.finished
  );

  animateNumber(
    "analyticsFinished",
    state.finished
  );

  animateNumber(
    "analyticsSkip",
    skipCount
  );

  animateNumber(
    "analyticsGive",
    giveawayCount
  );

  renderQueueLists();
  updateTimer();
}

/* =========================================================
   SOCKET-STATE
========================================================= */

function updateState(data, detect = true) {
  const oldIds =
    new Set(
      state.queue.map(
        entry => String(entry.id)
      )
    );

  state.current =
    data.current || null;

  state.queue =
    Array.isArray(data.queue)
      ? data.queue
      : [];

  if (state.current) {
    if (
      String(state.current.id) !==
      String(state.lastCurrentId)
    ) {
      state.currentStartedAt =
        Date.now();

      state.lastCurrentId =
        String(state.current.id);

      sessionStorage.setItem(
        "pxCurrentStartedAt",
        state.currentStartedAt
      );

      sessionStorage.setItem(
        "pxCurrentId",
        state.lastCurrentId
      );
    }
  } else {
    state.currentStartedAt = 0;
    state.lastCurrentId = null;

    sessionStorage.removeItem(
      "pxCurrentStartedAt"
    );

    sessionStorage.removeItem(
      "pxCurrentId"
    );
  }

  if (detect) {
    state.queue.forEach(entry => {
      if (oldIds.has(String(entry.id))) {
        return;
      }

      if (isQueueClosedEntry(entry)) {
        addActivity(
          "Køen ble stengt",
          "⛔"
        );

        return;
      }

      addActivity(
        `Ny ordre: ${safeDisplayName(entry)}`,
        entry.skipTheLine ||
        entry.priority
          ? "⚡"
          : entry.giveaway
            ? "🎁"
            : "🟢"
      );
    });
  }

  render();
}

/* =========================================================
   AKTIV ORDRE
========================================================= */

function updateTimer() {
  if (
    !state.current ||
    !state.currentStartedAt
  ) {
    $("heroTimer").textContent =
      "00:00";

    return;
  }

  const seconds =
    Math.floor(
      (
        Date.now() -
        state.currentStartedAt
      ) / 1000
    );

  const minutes =
    Math.floor(seconds / 60);

  const remainingSeconds =
    seconds % 60;

  $("heroTimer").textContent =
    `${String(minutes).padStart(2, "0")}:` +
    `${String(remainingSeconds).padStart(2, "0")}`;
}

async function next() {
  const nextCustomer =
    state.queue.find(
      entry => !isQueueClosedEntry(entry)
    );

  if (!nextCustomer) {
    toast(
      "Ingen kunder igjen i køen"
    );

    return;
  }

  const name =
    safeDisplayName(nextCustomer);

  try {
    await post("/api/next");

    addActivity(
      `Startet ordre: ${name}`,
      "📦"
    );

    toast(
      "Åpnes nå",
      name
    );

    playSound("order");
  } catch (error) {
    toast(
      "Kunne ikke starte",
      error.message
    );
  }
}

async function finish() {
  if (!state.current) {
    toast("Ingen aktiv ordre");
    return;
  }

  const name =
    safeDisplayName(state.current);

  if (
    settings.confirmFinish &&
    !confirm(
      `Marker ${name} som ferdig?`
    )
  ) {
    return;
  }

  try {
    await post("/api/finish");

    state.finished += 1;

    sessionStorage.setItem(
      "pxFinished",
      state.finished
    );

    addActivity(
      `Ferdig: ${name}`,
      "✅"
    );

    toast(
      "Ordre ferdig",
      name
    );

    playSound("finish");
  } catch (error) {
    toast(
      "Kunne ikke fullføre",
      error.message
    );
  }
}

/* =========================================================
   HANDLINGER PÅ KØKORT
========================================================= */

async function act(id, action) {
  const entry =
    state.queue.find(
      queueEntry =>
        String(queueEntry.id) ===
        String(id)
    );

  if (
    !entry ||
    isQueueClosedEntry(entry)
  ) {
    return;
  }

  const name =
    safeDisplayName(entry);

  try {
    if (action === "delete") {
      if (
        !confirm(
          `Fjerne ${name}?`
        )
      ) {
        return;
      }

      await api(
        `/api/queue/${id}`,
        {
          method: "DELETE"
        }
      );

      addActivity(
        `Fjernet: ${name}`,
        "🗑"
      );

      return;
    }

    if (action === "open") {
      await post(
        `/api/queue/${id}/top`
      );

      await post("/api/next");

      addActivity(
        `Åpnet direkte: ${name}`,
        "📦"
      );

      toast(
        "Åpnes nå",
        name
      );

      playSound("order");
      return;
    }

    await post(
      `/api/queue/${id}/${action}`
    );

    if (action === "skip") {
      addActivity(
        `Skip aktivert: ${name}`,
        "⚡"
      );

      playSound("skip");
    } else {
      addActivity(
        `Flyttet til topp: ${name}`,
        "↕"
      );
    }
  } catch (error) {
    toast(
      "Handling feilet",
      error.message
    );
  }
}

function handleQueueClick(event) {
  const button =
    event.target.closest(
      "[data-action]"
    );

  const card =
    event.target.closest(
      ".queue-card"
    );

  if (!button || !card) {
    return;
  }

  if (
    card.dataset.systemCard ===
    "queue-closed"
  ) {
    return;
  }

  act(
    card.dataset.id,
    button.dataset.action
  );
}

/* =========================================================
   DRA OG SLIPP
========================================================= */

function bindDragAndDrop() {
  document
    .querySelectorAll(
      ".queue-card[draggable=true]"
    )
    .forEach(card => {
      card.ondragstart = () => {
        card.classList.add(
          "dragging"
        );

        state.selectedId =
          card.dataset.id;
      };

      card.ondragend = () => {
        card.classList.remove(
          "dragging"
        );

        document
          .querySelectorAll(
            ".drop-target"
          )
          .forEach(element => {
            element.classList.remove(
              "drop-target"
            );
          });
      };

      card.ondragover = event => {
        event.preventDefault();

        card.classList.add(
          "drop-target"
        );
      };

      card.ondragleave = () => {
        card.classList.remove(
          "drop-target"
        );
      };

      card.ondrop = async event => {
        event.preventDefault();

        card.classList.remove(
          "drop-target"
        );

        const customerQueue =
          getCustomerQueue();

        const fromIndex =
          customerQueue.findIndex(
            entry =>
              String(entry.id) ===
              String(state.selectedId)
          );

        const toIndex =
          customerQueue.findIndex(
            entry =>
              String(entry.id) ===
              String(card.dataset.id)
          );

        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex === toIndex
        ) {
          return;
        }

        const ids =
          customerQueue.map(
            entry => entry.id
          );

        const [movedId] =
          ids.splice(fromIndex, 1);

        ids.splice(
          toIndex,
          0,
          movedId
        );

        const closedCard =
          state.queue.find(
            isQueueClosedEntry
          );

        if (closedCard) {
          ids.push(closedCard.id);
        }

        try {
          await post(
            "/api/queue/reorder",
            { ids }
          );

          addActivity(
            "Køen ble omorganisert",
            "↕"
          );
        } catch (error) {
          toast(
            "Kunne ikke flytte",
            error.message
          );
        }
      };

      card.oncontextmenu = event => {
        event.preventDefault();

        state.selectedId =
          card.dataset.id;

        const menu =
          $("contextMenu");

        menu.hidden = false;

        menu.style.left =
          `${Math.min(
            event.clientX,
            innerWidth - 215
          )}px`;

        menu.style.top =
          `${Math.min(
            event.clientY,
            innerHeight - 190
          )}px`;
      };
    });
}

/* =========================================================
   KNAPPER OG SKJEMA
========================================================= */

document
  .querySelectorAll(".nav-item")
  .forEach(button => {
    button.onclick = () => {
      switchView(
        button.dataset.view
      );
    };
  });

document
  .querySelectorAll(
    "[data-view-link]"
  )
  .forEach(button => {
    button.onclick = () => {
      switchView(
        button.dataset.viewLink
      );
    };
  });

document
  .querySelectorAll(
    "[data-command=next]"
  )
  .forEach(button => {
    button.onclick = next;
  });

document
  .querySelectorAll(
    "[data-command=finish]"
  )
  .forEach(button => {
    button.onclick = finish;
  });

$("menuBtn").onclick = () => {
  $("sidebar").classList.toggle(
    "open"
  );
};

$("dashboardQueue").onclick =
  handleQueueClick;

$("fullQueue").onclick =
  handleQueueClick;

$("giveawayList").onclick =
  handleQueueClick;

$("queueSearch").oninput =
  renderQueueLists;

$("queueFilter").onchange =
  renderQueueLists;

$("clearFeed").onclick = () => {
  state.activities = [];

  sessionStorage.removeItem(
    "pxActivities"
  );

  renderActivity();
};

$("clearQueue").onclick =
  async () => {
    if (
      !confirm(
        "Tømme hele ventelisten?"
      )
    ) {
      return;
    }

    try {
      await api(
        "/api/queue",
        {
          method: "DELETE"
        }
      );

      addActivity(
        "Køen ble tømt",
        "🧹"
      );
    } catch (error) {
      toast(
        "Kunne ikke tømme køen",
        error.message
      );
    }
  };

$("addManual").onclick =
  async () => {
    const name =
      $("manualName").value.trim();

    const twitchName =
      cleanTwitch(
        $("manualTwitch").value
      );

    const order =
      $("manualOrder").value.trim();

    const items =
      $("manualItems").value.trim();

    if (!name && !twitchName) {
      toast(
        "Skriv inn navn eller Twitch-navn"
      );

      return;
    }

    try {
      await post(
        "/api/queue",
        {
          name: name || twitchName,
          twitchName,
          order,
          items,
          skipTheLine:
            $("manualSkip").checked,
          giveaway:
            $("manualGive").checked
        }
      );

      [
        "manualName",
        "manualTwitch",
        "manualOrder",
        "manualItems"
      ].forEach(id => {
        $(id).value = "";
      });

      $("manualSkip").checked = false;
      $("manualGive").checked = false;
    } catch (error) {
      toast(
        "Kunne ikke legge til",
        error.message
      );
    }
  };

$("addGiveaway").onclick =
  async () => {
    const name =
      $("giveName").value.trim() ||
      "Pokebua Giveaway";

    const order =
      $("giveOrder").value.trim();

    const items =
      $("giveItems").value.trim();

    if (!items) {
      toast(
        "Skriv inn premien"
      );

      return;
    }

    try {
      await post(
        "/api/queue",
        {
          name,
          order,
          items,
          giveaway: true
        }
      );

      [
        "giveName",
        "giveOrder",
        "giveItems"
      ].forEach(id => {
        $(id).value = "";
      });
    } catch (error) {
      toast(
        "Kunne ikke legge til giveaway",
        error.message
      );
    }
  };

$("openOverlay").onclick = () => {
  window.open(
    "/overlay.html",
    "_blank"
  );
};

$("copyOverlay").onclick =
  async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/overlay.html`
      );

      toast(
        "Overlay-URL kopiert"
      );
    } catch {
      toast(
        "Kunne ikke kopiere URL"
      );
    }
  };

$("testAlert").onclick = () => {
  toast(
    "Studio-varsel",
    "Powered by Pokebua"
  );

  playSound("skip");
};

document
  .querySelectorAll("[data-sound]")
  .forEach(button => {
    button.onclick = () => {
      playSound(
        button.dataset.sound
      );
    };
  });

[
  "confirmFinish",
  "studioSounds",
  "showBoot"
].forEach(id => {
  $(id).onchange =
    saveSettings;
});

$("confirmFinish").checked =
  settings.confirmFinish;

$("studioSounds").checked =
  settings.sounds;

$("showBoot").checked =
  settings.showBoot;

/* =========================================================
   HØYREKLIKKSMENY
========================================================= */

$("contextMenu").onclick =
  event => {
    const button =
      event.target.closest(
        "[data-context]"
      );

    if (!button) {
      return;
    }

    act(
      state.selectedId,
      button.dataset.context
    );

    $("contextMenu").hidden =
      true;
  };

document.addEventListener(
  "click",
  event => {
    if (
      !event.target.closest(
        "#contextMenu"
      )
    ) {
      $("contextMenu").hidden =
        true;
    }
  }
);

/* =========================================================
   TASTATURSNARVEIER
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    if (
      /INPUT|TEXTAREA|SELECT/.test(
        event.target.tagName
      )
    ) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      next();
      return;
    }

    if (
      event.key.toLowerCase() === "f"
    ) {
      finish();
      return;
    }

    if (
      event.key.toLowerCase() === "q"
    ) {
      switchView("queue");
    }
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

socket.on("connect", () => {
  $("statusDot").classList.add(
    "online"
  );

  $("statusText").textContent =
    "Tilkoblet";

  $("statStatus").textContent =
    "ONLINE";
});

socket.on("disconnect", () => {
  $("statusDot").classList.remove(
    "online"
  );

  $("statusText").textContent =
    "Frakoblet";

  $("statStatus").textContent =
    "OFFLINE";
});

socket.on(
  "queue:update",
  data => {
    updateState(data, true);
  }
);

socket.on(
  "order:alert",
  payload => {
    toast(
      "Ny ordre",
      safeDisplayName(payload)
    );

    playSound("order");
  }
);

socket.on(
  "skip:alert",
  payload => {
    toast(
      "Skip the Line",
      safeDisplayName(payload)
    );

    playSound("skip");
  }
);

socket.on(
  "giveaway:alert",
  payload => {
    toast(
      "Giveaway",
      safeDisplayName(payload)
    );

    playSound("giveaway");
  }
);

/* =========================================================
   OPPSTART
========================================================= */

renderActivity();

setInterval(
  updateTimer,
  1000
);

setInterval(
  renderQueueLists,
  60000
);

api("/api/queue")
  .then(data => {
    updateState(data, false);
  })
  .catch(error => {
    toast(
      "Kunne ikke hente køen",
      error.message
    );
  });

if (settings.showBoot) {
  const steps = [
    "Initializing Studio",
    "Connecting Queue",
    "Loading Overlay",
    "Privacy Check",
    "Connected"
  ];

  let index = 0;

  const timer = setInterval(() => {
    index += 1;

    $("bootText").textContent =
      steps[
        Math.min(
          index,
          steps.length - 1
        )
      ];

    if (
      index >=
      steps.length - 1
    ) {
      clearInterval(timer);

      setTimeout(() => {
        $("boot").classList.add(
          "hidden"
        );
      }, 300);
    }
  }, 250);
} else {
  $("boot").classList.add(
    "hidden"
  );
}
