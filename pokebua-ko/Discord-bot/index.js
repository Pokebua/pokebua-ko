const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  Events,
  MessageFlags,
} = require("discord.js");

const { DateTime } = require("luxon");

// ======================================================
// INNSTILLINGER
// ======================================================

const requiredEnv = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "GUILD_ID",
  "CHANNEL_ID",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Mangler miljøvariabel: ${key}`);
    process.exit(1);
  }
}

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const TIME_ZONE = "Europe/Oslo";

const DEADLINE_KEY = "BUABOT_CGC_DEADLINE=";
const MESSAGE_KEY = "BUABOT_CGC_MESSAGE_ID=";

// ======================================================
// DISCORD-KLIENT
// ======================================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ======================================================
// SLASH-KOMMANDOER
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("cgcfrist")
    .setDescription("Sett ny frist for CGC-gradering")
    .addStringOption((option) =>
      option
        .setName("dato")
        .setDescription("Skriv dato som DD.MM.ÅÅÅÅ")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("cgcfrist-vis")
    .setDescription("Vis gjeldende CGC-frist")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("cgcfrist-oppdater")
    .setDescription("Oppdater CGC-meldingen manuelt")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("cgcfrist-fjern")
    .setDescription("Fjern CGC-fristen og meldingen")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),
].map((command) => command.toJSON());

// ======================================================
// DATO
// ======================================================

function parseNorwegianDate(input) {
  const match = input
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;

  const date = DateTime.fromObject(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 23,
      minute: 59,
      second: 59,
    },
    {
      zone: TIME_ZONE,
    }
  );

  return date.isValid ? date : null;
}

function calculateDaysLeft(deadline) {
  const today = DateTime.now()
    .setZone(TIME_ZONE)
    .startOf("day");

  const target = deadline
    .setZone(TIME_ZONE)
    .startOf("day");

  return Math.ceil(
    target.diff(today, "days").days
  );
}

// ======================================================
// LAGRING I KANALBESKRIVELSEN
// ======================================================

function readMarker(topic, key) {
  const safeTopic = topic ?? "";

  const line = safeTopic
    .split("\n")
    .find((item) => item.startsWith(key));

  if (!line) {
    return null;
  }

  return line.slice(key.length).trim() || null;
}

function writeMarker(topic, key, value) {
  const safeTopic = topic ?? "";

  const normalLines = safeTopic
    .split("\n")
    .filter((line) => !line.startsWith(key))
    .filter((line) => line.trim() !== "");

  if (value !== null && value !== undefined) {
    normalLines.push(`${key}${value}`);
  }

  const result = normalLines.join("\n").trim();

  return result || null;
}

function readDeadline(topic) {
  const storedDate = readMarker(
    topic,
    DEADLINE_KEY
  );

  if (!storedDate) {
    return null;
  }

  const deadline = DateTime.fromISO(
    storedDate,
    {
      zone: TIME_ZONE,
    }
  ).endOf("day");

  return deadline.isValid ? deadline : null;
}

function readMessageId(topic) {
  return readMarker(topic, MESSAGE_KEY);
}

// ======================================================
// DESIGN
// ======================================================

function getEmbedColor(daysLeft) {
  // Grønn: god tid
  if (daysLeft >= 11) {
    return 0x22c55e;
  }

  // Gul: begynner å nærme seg
  if (daysLeft >= 5) {
    return 0xfacc15;
  }

  // Rød: haster
  return 0xef4444;
}

function getProgressBar(daysLeft) {
  if (daysLeft <= 0) {
    return "🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥";
  }

  const filledBlocks = Math.min(
    10,
    Math.max(1, daysLeft)
  );

  const emptyBlocks = 10 - filledBlocks;

  let filledEmoji;

  if (daysLeft >= 11) {
    filledEmoji = "🟩";
  } else if (daysLeft >= 5) {
    filledEmoji = "🟨";
  } else {
    filledEmoji = "🟥";
  }

  return (
    filledEmoji.repeat(filledBlocks) +
    "⬜".repeat(emptyBlocks)
  );
}

function getDeadlineText(daysLeft, deadline) {
  const formattedDate =
    deadline.toFormat("dd.MM.yyyy");

  if (daysLeft > 1) {
    return (
      `⏳ **Frist for CGC Gradering er ` +
      `${daysLeft} dager.** *(${formattedDate})*`
    );
  }

  if (daysLeft === 1) {
    return (
      `⏳ **Frist for CGC Gradering er ` +
      `1 dag.** *(${formattedDate})*`
    );
  }

  if (daysLeft === 0) {
    return (
      `🚨 **Frist for CGC Gradering er ` +
      `i dag!** *(${formattedDate})*`
    );
  }

  return (
    `❌ **Fristen for CGC Gradering har gått ut.** ` +
    `*(${formattedDate})*`
  );
}

function createCgcEmbed(deadline) {
  const daysLeft =
    calculateDaysLeft(deadline);

  const progressBar =
    getProgressBar(daysLeft);

  const deadlineText =
    getDeadlineText(daysLeft, deadline);

  const updatedTime = DateTime.now()
    .setZone(TIME_ZONE)
    .toFormat("dd.MM.yyyy 'kl.' HH:mm");

  return new EmbedBuilder()
    .setColor(getEmbedColor(daysLeft))
    .setTitle("📦 CGC Gradering")
    .setDescription(
      [
        deadlineText,
        "",
        progressBar,
        "",
        "📮 **Husk å sende kort i posten minst 5 virkedager før fristen.**",
        "",
        "📍 **Bor du i Nord-Norge?**",
        "Send kortene minst **8 virkedager før fristen.**",
      ].join("\n")
    )
    .setFooter({
      text: `Sist oppdatert: ${updatedTime} • Powered by Pokebua`,
    });
}

// ======================================================
// KANAL OG MELDING
// ======================================================

async function getTimerChannel() {
  const channel = await client.channels.fetch(
    CHANNEL_ID
  );

  if (!channel) {
    throw new Error(
      "Fant ikke kanalen. Kontroller CHANNEL_ID."
    );
  }

  if (
    !channel.isTextBased() ||
    !channel.messages ||
    !("setTopic" in channel)
  ) {
    throw new Error(
      "CHANNEL_ID må være ID-en til en vanlig tekstkanal."
    );
  }

  return channel;
}

async function saveDeadline(channel, deadline) {
  let newTopic = writeMarker(
    channel.topic,
    DEADLINE_KEY,
    deadline.toISODate()
  );

  await channel.setTopic(
    newTopic,
    "Ny CGC-frist satt"
  );
}

async function saveMessageId(
  channel,
  messageId
) {
  const newTopic = writeMarker(
    channel.topic,
    MESSAGE_KEY,
    messageId
  );

  await channel.setTopic(
    newTopic,
    "BuaBot lagret CGC-meldingen"
  );
}

async function createOrUpdateCgcMessage() {
  const channel = await getTimerChannel();

  const deadline = readDeadline(
    channel.topic
  );

  if (!deadline) {
    console.log("Ingen CGC-frist er satt.");
    return null;
  }

  const embed = createCgcEmbed(deadline);

  const storedMessageId = readMessageId(
    channel.topic
  );

  // Forsøk å redigere den eksisterende meldingen
  if (storedMessageId) {
    try {
      const existingMessage =
        await channel.messages.fetch(
          storedMessageId
        );

      await existingMessage.edit({
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      console.log(
        "CGC-meldingen ble oppdatert."
      );

      return existingMessage;
    } catch (error) {
      console.log(
        "Fant ikke den gamle CGC-meldingen. Lager en ny."
      );
    }
  }

  // Lager bare en ny melding dersom ingen finnes
  const newMessage = await channel.send({
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });

  await saveMessageId(
    channel,
    newMessage.id
  );

  console.log(
    `Ny CGC-melding opprettet: ${newMessage.id}`
  );

  return newMessage;
}

async function deleteCgcMessage() {
  const channel = await getTimerChannel();

  const messageId = readMessageId(
    channel.topic
  );

  if (messageId) {
    try {
      const message =
        await channel.messages.fetch(
          messageId
        );

      await message.delete();
    } catch (error) {
      console.log(
        "CGC-meldingen var allerede slettet."
      );
    }
  }

  let newTopic = writeMarker(
    channel.topic,
    DEADLINE_KEY,
    null
  );

  newTopic = writeMarker(
    newTopic,
    MESSAGE_KEY,
    null
  );

  await channel.setTopic(
    newTopic,
    "CGC-frist fjernet"
  );
}

// ======================================================
// REGISTRER KOMMANDOER
// ======================================================

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      GUILD_ID
    ),
    {
      body: commands,
    }
  );

  console.log(
    "Slash-kommandoer registrert."
  );
}

// ======================================================
// BOTEN STARTER
// ======================================================

client.once(
  Events.ClientReady,
  async (readyClient) => {
    console.log(
      `BuaBot er pålogget som ${readyClient.user.tag}`
    );

    try {
      await createOrUpdateCgcMessage();
    } catch (error) {
      console.error(
        "Kunne ikke oppdatere CGC-meldingen:",
        error
      );
    }

    // Sjekker én gang i timen.
    // Den redigerer den samme meldingen,
    // og sender derfor ikke en ny melding.
    setInterval(async () => {
      try {
        await createOrUpdateCgcMessage();
      } catch (error) {
        console.error(
          "Automatisk oppdatering feilet:",
          error
        );
      }
    }, 60 * 60 * 1000);
  }
);

// ======================================================
// KOMMANDOER
// ======================================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      if (
        interaction.commandName ===
        "cgcfrist"
      ) {
        const input =
          interaction.options.getString(
            "dato",
            true
          );

        const deadline =
          parseNorwegianDate(input);

        if (!deadline) {
          await interaction.reply({
            content:
              "Ugyldig dato. Bruk formatet `DD.MM.ÅÅÅÅ`, for eksempel `20.08.2026`.",
            flags: MessageFlags.Ephemeral,
          });

          return;
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });

        const channel =
          await getTimerChannel();

        await saveDeadline(
          channel,
          deadline
        );

        await createOrUpdateCgcMessage();

        await interaction.editReply({
          content:
            `CGC-fristen er satt til ` +
            `**${deadline.toFormat(
              "dd.MM.yyyy"
            )}**.\n\n` +
            "CGC-meldingen er oppdatert.",
        });

        return;
      }

      if (
        interaction.commandName ===
        "cgcfrist-vis"
      ) {
        const channel =
          await getTimerChannel();

        const deadline = readDeadline(
          channel.topic
        );

        if (!deadline) {
          await interaction.reply({
            content:
              "Det er ikke satt noen CGC-frist.",
            flags: MessageFlags.Ephemeral,
          });

          return;
        }

        const daysLeft =
          calculateDaysLeft(deadline);

        await interaction.reply({
          content:
            `Gjeldende CGC-frist er ` +
            `**${deadline.toFormat(
              "dd.MM.yyyy"
            )}**.\n` +
            `Det er **${daysLeft} dager igjen**.`,
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      if (
        interaction.commandName ===
        "cgcfrist-oppdater"
      ) {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });

        const message =
          await createOrUpdateCgcMessage();

        if (!message) {
          await interaction.editReply({
            content:
              "Det er ikke satt noen CGC-frist.",
          });

          return;
        }

        await interaction.editReply({
          content:
            "CGC-meldingen er oppdatert.",
        });

        return;
      }

      if (
        interaction.commandName ===
        "cgcfrist-fjern"
      ) {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });

        await deleteCgcMessage();

        await interaction.editReply({
          content:
            "CGC-fristen og meldingen er fjernet.",
        });
      }
    } catch (error) {
      console.error(error);

      const errorMessage =
        "Noe gikk galt. Kontroller at boten har tilgang til kanalen og tillatelsene **View Channel**, **Send Messages**, **Read Message History** og **Manage Channels**.";

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction.editReply({
          content: errorMessage,
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
);

// ======================================================
// START
// ======================================================

(async () => {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error(
      "BuaBot kunne ikke starte:",
      error
    );

    process.exit(1);
  }
})();
