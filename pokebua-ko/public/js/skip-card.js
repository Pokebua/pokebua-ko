(() => {
  const ANIMATION_DURATION = 6500;

  let animationTimer = null;
  let eventElement = null;

  function cleanName(value) {
    const name = String(value ?? "").trim();

    if (!name) {
      return "Kunde";
    }

    return name.split(/\s+/)[0];
  }

  function createParticles(amount = 40) {
    return Array.from({ length: amount }, (_, index) => {
      const angle = index * (360 / amount);
      const distance = 220 + Math.random() * 650;
      const size = 4 + Math.random() * 12;
      const delay = 1.75 + Math.random() * 0.45;
      const duration = 1.1 + Math.random() * 0.8;

      return `
        <span
          class="skipfx-particle"
          style="
            --angle:${angle}deg;
            --distance:${distance}px;
            --size:${size}px;
            --delay:${delay}s;
            --duration:${duration}s;
          "
        ></span>
      `;
    }).join("");
  }

  function buildEvent() {
    if (eventElement) {
      return eventElement;
    }

    eventElement = document.createElement("div");
    eventElement.id = "skipCardEvent";
    eventElement.className = "skipfx-event";
    eventElement.setAttribute("aria-hidden", "true");

    eventElement.innerHTML = `
      <div class="skipfx-backdrop"></div>
      <div class="skipfx-speed-lines"></div>
      <div class="skipfx-flash"></div>
      <div class="skipfx-shockwave"></div>

      <div class="skipfx-stage">
        <div class="skipfx-card">
          <img
            class="skipfx-card-image"
            src="/assets/skip-card.png"
            alt=""
          />

          <div class="skipfx-card-glow"></div>
          <div class="skipfx-card-crack"></div>
        </div>

        <div class="skipfx-character">
          <img
            class="skipfx-character-image"
            src="/assets/skip-character.png"
            alt=""
            onerror="this.parentElement.classList.add('missing-image')"
          />

          <div class="skipfx-character-fire"></div>
        </div>

        <div class="skipfx-sign-wrap">
          <div class="skipfx-sign">
            <div class="skipfx-sign-title">
              SKIP THE LINE
            </div>

            <div
              id="skipCardName"
              class="skipfx-sign-name"
            >
              Kunde
            </div>
          </div>
        </div>

        <div class="skipfx-particles">
          ${createParticles()}
        </div>
      </div>
    `;

    document.body.appendChild(eventElement);

    return eventElement;
  }

  function stop() {
    clearTimeout(animationTimer);
    animationTimer = null;

    const event = buildEvent();

    event.classList.remove("show");
    event.setAttribute("aria-hidden", "true");
  }

  function play(name) {
    const event = buildEvent();

    clearTimeout(animationTimer);

    const nameElement =
      event.querySelector("#skipCardName");

    if (nameElement) {
      nameElement.textContent = cleanName(name);
    }

    /*
      Fjerner klassen og tvinger en reflow.
      Da kan animasjonen starte på nytt hver gang.
    */
    event.classList.remove("show");
    event.setAttribute("aria-hidden", "true");

    void event.offsetWidth;

    event.setAttribute("aria-hidden", "false");
    event.classList.add("show");

    animationTimer = setTimeout(() => {
      stop();
    }, ANIMATION_DURATION + 200);
  }

  buildEvent();

  window.PokebuaSkipCard = {
    play,
    stop
  };
})();
