const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { DateTime } = require("luxon");

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
const TOPIC_KEY = "BUABOT_CGC_DEADLINE=";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName("cgcfrist")
    .setDescription("Sett ny frist for CGC-gradering")
    .addStringOption((option) =>
      option
        .setName("dato")
        .setDescription("DD.MM.ÅÅÅÅ, for eksempel 20.08.2026")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("cgcfrist-vis")
    .setDescription("Vis gjeldende frist for CGC-gradering")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("cgcfrist-fjern")
    .setDescription("Fjern gjeldende CGC-frist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());

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

function readDeadlineFromTopic(topic) {
  const safeTopic = topic ?? "";

  const match = safeTopic.match(
    /BUABOT_CGC_DEADLINE=(\d{4}-\d{2}-\d{2})/
  );

  if (!match) {
    return null;
  }

  const deadline = DateTime.fromISO(match[1], {
    zone: TIME_ZONE,
  }).endOf("day");

  return deadline.isValid ? deadline : null;
}

function writeDeadlineToTopic(currentTopic, deadline = null) {
  const safeTopic = currentTopic ?? "";

  const cleaned = safeTopic
    .split("\n")
    .filter((line) => !line.startsWith(TOPIC_KEY))
    .join("\n")
    .trim();

  if (!deadline) {
    return cleaned || null;
  }

  const marker = `${TOPIC_KEY}${deadline.toISODate()}`;

  return cleaned
    ? `${cleaned}\n${marker}`
    : marker;
}

function getChannelName(deadline) {
  const today = DateTime.now()
    .setZone(TIME_ZONE)
    .startOf("day");

  const target = deadline
    .setZone(TIME_ZONE)
    .startOf("day");

  const days = Math.ceil(
    target.diff(today, "days").days
  );

  if (days > 1) {
    return `📦・frist-for-cgc-gradering-${days}-dager`;
  }

  if (days === 1) {
    return "📦・frist-for-cgc-gradering-1-dag";
  }

  if (days === 0) {
    return "📦・frist-for-cgc-gradering-i-dag";
  }

  return "📦・cgc-fristen-har-gått-ut";
}

async function getTimerChannel() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel) {
    throw new Error(
      "Fant ikke kanalen. Kontroller CHANNEL_ID."
    );
  }

  if (
    !channel.isTextBased() ||
    !("setName" in channel) ||
    !("setTopic" in channel)
  ) {
    throw new Error(
      "Kanalen må være en vanlig tekstkanal."
    );
  }

  return channel;
}

async function updateChannelName() {
  const channel = await getTimerChannel();

  const deadline = readDeadlineFromTopic(
    channel.topic
  );

  if (!deadline) {
    console.log("Ingen CGC-frist er satt.");
    return;
  }

  const wantedName = getChannelName(deadline);

  if (channel.name !== wantedName) {
    await channel.setName(
      wantedName,
      "Automatisk CGC-nedtelling"
    );

    console.log(
      `Kanalnavn oppdatert til: ${wantedName}`
    );
  }
}

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

  console.log("Slash-kommandoer registrert.");
}

client.once("clientReady", async () => {
  console.log(
    `BuaBot er pålogget som ${client.user.tag}`
  );

  try {
    await updateChannelName();
  } catch (error) {
    console.error(
      "Kunne ikke oppdatere kanalnavnet:",
      error
    );
  }

  setInterval(async () => {
    try {
      await updateChannelName();
    } catch (error) {
      console.error(
        "Automatisk oppdatering feilet:",
        error
      );
    }
  }, 60 * 60 * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    const channel = await getTimerChannel();

    if (interaction.commandName === "cgcfrist") {
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
          ephemeral: true,
        });

        return;
      }

      const newTopic = writeDeadlineToTopic(
        channel.topic,
        deadline
      );

      await channel.setTopic(
        newTopic,
        `CGC-frist satt av ${interaction.user.tag}`
      );

      const newName =
        getChannelName(deadline);

      if (channel.name !== newName) {
        await channel.setName(
          newName,
          `CGC-frist satt av ${interaction.user.tag}`
        );
      }

      await interaction.reply({
        content:
          `CGC-fristen er satt til **${deadline.toFormat(
            "dd.MM.yyyy"
          )}**.`,
        ephemeral: true,
      });

      return;
    }

    if (
      interaction.commandName ===
      "cgcfrist-vis"
    ) {
      const deadline =
        readDeadlineFromTopic(channel.topic);

      await interaction.reply({
        content: deadline
          ? `Gjeldende CGC-frist er **${deadline.toFormat(
              "dd.MM.yyyy"
            )}**.`
          : "Det er ikke satt noen CGC-frist.",
        ephemeral: true,
      });

      return;
    }

    if (
      interaction.commandName ===
      "cgcfrist-fjern"
    ) {
      const newTopic =
        writeDeadlineToTopic(
          channel.topic,
          null
        );

      await channel.setTopic(
        newTopic,
        `CGC-frist fjernet av ${interaction.user.tag}`
      );

      await channel.setName(
        "📦・frist-for-cgc-gradering",
        "CGC-frist fjernet"
      );

      await interaction.reply({
        content: "CGC-fristen er fjernet.",
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);

    const message =
      "Noe gikk galt. Kontroller kanal-ID og at boten har View Channel og Manage Channels.";

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      await interaction.followUp({
        content: message,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: message,
        ephemeral: true,
      });
    }
  }
});

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
