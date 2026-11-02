const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

const db = new sqlite3.Database('./vibe_stats.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
    else console.log('✅ متصل بقاعدة بيانات SQLite بنجاح.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (user_id TEXT, timestamp TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS voice (user_id TEXT, duration INTEGER, timestamp TEXT)`);
});

const voiceJoinTimes = new Map();

client.once('ready', async () => {
    console.log(`✅ تم تسجيل الدخول بنجاح باسم: ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('top')
            .setDescription('عرض أكثر الأعضاء تفاعلاً (صوت أو شات) من تاريخ محدد')
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('اختر نوع الإحصائية')
                    .setRequired(true)
                    .addChoices(
                        { name: 'صوت (Voice)', value: 'voice' },
                        { name: 'شات (Chat)', value: 'chat' }
                    ))
            .addStringOption(option =>
                option.setName('start_date')
                    .setDescription('تاريخ البداية بصيغة YYYY-MM-DD (مثال: 2026-01-01)')
                    .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل أوامر البوت بنجاح.');
    } catch (error) {
        console.error(error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.run(`INSERT INTO messages (user_id, timestamp) VALUES (?, ?)`, [message.author.id, nowStr]);
});

client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member;
    if (member.user.bot) return;
    const now = new Date();

    if (!oldState.channelId && newState.channelId) {
        voiceJoinTimes.set(member.id, now);
    } else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceJoinTimes.get(member.id);
        if (joinTime) {
            const durationSeconds = Math.floor((now - joinTime) / 1000);
            const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');
            db.run(`INSERT INTO voice (user_id, duration, timestamp) VALUES (?, ?, ?)`, [member.id, durationSeconds, nowStr]);
            voiceJoinTimes.delete(member.id);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'top') {
        await interaction.deferReply();
        const type = interaction.options.getString('type');
        const startDate = interaction.options.getString('start_date');

        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            await interaction.editReply("❌ صيغة التاريخ خطأ! استخدم: `YYYY-MM-DD` (مثال: `2026-11-01`)");
            return;
        }

        const fullStartDate = startDate + " 00:00:00";

        if (type === 'chat') {
            db.all(`SELECT user_id, COUNT(*) as count FROM messages WHERE timestamp >= ? GROUP BY user_id ORDER BY count DESC LIMIT 5`, [fullStartDate], (err, rows) => {
                sendTopEmbed(interaction, rows, 'chat', startDate);
            });
        } else {
            db.all(`SELECT user_id, SUM(duration) as total_duration FROM voice WHERE timestamp >= ? GROUP BY user_id ORDER BY total_duration DESC LIMIT 5`, [fullStartDate], (err, rows) => {
                sendTopEmbed(interaction, rows, 'voice', startDate);
            });
        }
    }
});

async function sendTopEmbed(interaction, rows, type, startDate) {
    if (!rows || rows.length === 0) {
        await interaction.editReply(`⚠️ ما فيه أي بيانات مسجلة لـ **${type}** ابتداءً من تاريخ \`${startDate}\`.`);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`🏆 لوحة الشرف (${type.toUpperCase()})`)
        .setDescription(`التفاصيل ابتداءً من تاريخ: **${startDate}**`)
        .setColor(0xFFD700);

    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
        const name = member ? `<@${row.user_id}>` : `مستخدم مغادر (${row.user_id})`;

        let valStr = "";
        if (type === 'voice') {
            const hours = Math.floor(row.total_duration / 3600);
            const minutes = Math.floor((row.total_duration % 3600) / 60);
            valStr = `${hours} ساعة و ${minutes} دقيقة`;
        } else {
            valStr = `${row.count} رسالة`;
        }

        embed.addFields({ name: `${medals[i]} المركز الـ ${i + 1}`, value: `اللاعب: ${name}\nالنتيجة: **${valStr}**`, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);