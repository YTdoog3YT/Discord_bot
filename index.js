require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ApplicationCommandOptionType,
    PermissionFlagsBits 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const Parser = require('rss-parser'); // Nowy moduł do czytania nowości z neta

// Mikro-serwer dla UptimeRobot
const app = express();
app.get('/', (req, res) => res.send('Kombajn działa i ma się dobrze!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Serwer podtrzymujący odpalony!'));

// Inicjalizacja bota
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Baza danych
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Połączono z bazą MongoDB!'))
    .catch(err => console.error('❌ Błąd bazy danych:', err));

const CHANNELS = {
    WELCOME: '1279161469132341428',
    LEAVE: '1279161514670162082',
    ADMIN_CMDS: '1256544039579156541',
    MOD_LOGS: '1256544115517292616',
    YT_VIDEO: '1256545068349915217',
    STREAMS: '1256545089606516768' // Kanał do streamów (do zrobienia)
};

// ==========================================
// AUTOMATYCZNY RADAR YOUTUBE
// ==========================================
const parser = new Parser();
const YOUTUBE_CHANNEL_ID = 'UC1QzrYhOlcmsOhZ5BQBZIvA'; // 
const YOUTUBE_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
let lastVideoId = ''; // Bot zapamiętuje ostatni film, żeby nie spamować

client.once('ready', async () => {
    console.log(`🤖 Kombajn wjechał na pole! Zalogowano jako: ${client.user.tag}`);

    // Rejestracja komend (tylko moderacja)
    const commands = [
        {
            name: 'ban', description: 'Zbanuj użytkownika',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Za co?', required: true },
                { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas (np. 1d, 1h)', required: false }
            ]
        },
        {
            name: 'kick', description: 'Wyrzuć użytkownika',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód', required: false }
            ]
        },
        {
            name: 'mute', description: 'Wycisz użytkownika',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true },
                { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas (np. 10m, 1h)', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód', required: false }
            ]
        }
    ];
    await client.application.commands.set(commands).catch(console.error);

    // PĘTLA YOUTUBE - SPRAWDZA CO 5 MINUT (300 000 ms)
    setInterval(async () => {
        try {
            if (YOUTUBE_CHANNEL_ID === 'TUTAJ_WKLEJ_ID_KANALU_YOUTUBE') return; 
            
            const feed = await parser.parseURL(YOUTUBE_FEED_URL);
            if (feed.items.length > 0) {
                const latestVideo = feed.items[0];
                
                // Jeśli wykryto nowy film
                if (lastVideoId !== latestVideo.id) {
                    if (lastVideoId !== '') { // Nie wysyłaj przy pierwszym uruchomieniu bota
                        const channel = client.channels.cache.get(CHANNELS.YT_VIDEO);
                        if (channel) {
                            const videoEmbed = new EmbedBuilder()
                                .setColor('#ff0000')
                                .setTitle('🔴 NOWY FILM NA KANALE!')
                                .setDescription(`Właśnie wjechał nowy materiał: **${latestVideo.title}**\n\n🔗 [Oglądaj tutaj!](${latestVideo.link})`)
                                .setTimestamp();

                            await channel.send({ content: '@everyone', embeds: [videoEmbed] });
                            console.log(`✅ Wysłano powiadomienie o nowym filmie: ${latestVideo.title}`);
                        }
                    }
                    lastVideoId = latestVideo.id; // Zapisz jako znany
                }
            }
        } catch (err) {
            console.error('❌ Błąd sprawdzania YouTube:', err.message);
        }
    }, 300000); 
});

// ==========================================
// POWITANIA, POŻEGNANIA I MODERACJA (Działa jak wcześniej)
// ==========================================
client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.get(CHANNELS.WELCOME);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor('#00e676').setTitle(`👋 Witamy!`).setDescription(`Siemano **${member.user.username}**!`).setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
    channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', member => {
    const channel = member.guild.channels.cache.get(CHANNELS.LEAVE);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor('#ff3333').setTitle(`😢 Ktoś nas opuścił...`).setDescription(`**${member.user.username}** poszedł sobie.`).setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
    channel.send({ embeds: [embed] });
});

function parseTimeToMs(timeStr) {
    if (!timeStr || timeStr.toLowerCase() === 'forever') return null;
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return null;
    const val = parseInt(match[1]), unit = match[2];
    if (unit === 's') return val * 1000; if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000; if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return null;
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.channelId !== CHANNELS.ADMIN_CMDS) return interaction.reply({ content: `🚫 Komendy tylko na <#${CHANNELS.ADMIN_CMDS}>!`, ephemeral: true });
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Brak uprawnień!', ephemeral: true });

    const command = interaction.commandName;
    const targetMember = interaction.options.getMember('uzytkownik');
    const reason = interaction.options.getString('powod') || 'Brak powodu';
    const timeString = interaction.options.getString('czas');
    const logChannel = await interaction.guild.channels.fetch(CHANNELS.MOD_LOGS).catch(() => null);

    if (!targetMember) return interaction.reply({ content: '❌ Nie znalazłem użytkownika.', ephemeral: true });
    if (!targetMember.manageable || !targetMember.bannable) return interaction.reply({ content: '❌ Ten użytkownik ma zbyt wysoką rolę!', ephemeral: true });

    const logEmbed = new EmbedBuilder().setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true })).setTimestamp().setFooter({ text: `Przez: ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

    try {
        if (command === 'ban') {
            const timeMs = parseTimeToMs(timeString);
            await targetMember.ban({ reason });
            logEmbed.setColor('#000000').setTitle('🔨 ZBANOWANO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}\n**Czas:** ${timeString || 'Zawsze'}`);
            if (timeMs) setTimeout(async () => { await interaction.guild.members.unban(targetMember.id).catch(() => {}); }, timeMs);
            await interaction.reply({ content: `✅ **${targetMember.user.username}** dostał bana.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }
        if (command === 'kick') {
            await targetMember.kick(reason);
            logEmbed.setColor('#ff9900').setTitle('👢 WYRZUCONO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}`);
            await interaction.reply({ content: `✅ **${targetMember.user.username}** wyrzucony.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }
        if (command === 'mute') {
            const timeMs = parseTimeToMs(timeString);
            if (!timeMs) return interaction.reply({ content: '❌ Podaj poprawny czas wyciszenia! Np. 10m, 1h.', ephemeral: true });
            await targetMember.timeout(timeMs, reason);
            logEmbed.setColor('#00bfff').setTitle('🔇 WYCISZONO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}\n**Czas:** ${timeString}`);
            await interaction.reply({ content: `✅ **${targetMember.user.username}** wyciszony na ${timeString}.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }
    } catch (error) {
        console.error(error);
        interaction.reply({ content: '❌ Błąd. Sprawdź logi.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);