require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const Parser = require('rss-parser');

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
        GatewayIntentBits.GuildModeration
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
    STREAMS: '1256545089606516768',
    TICKETS: '1256545036112232499',
    TICKETS_CATEGORY: '1554373278418862150' // <--- Kategoria dla nowych ticketów
};

// ==========================================
// USTAWIENIA TWÓRCY (Pamiętaj żeby tu były Twoje dane)
// ==========================================
const TWITCH_USERNAME = 'TUTAJ_WPISZ_NICK_Z_TWITCHA'; 
const YOUTUBE_CHANNEL_ID = 'TUTAJ_WPISZ_ID_KANALU_YOUTUBE'; 

const parser = new Parser();
let lastVideoId = ''; 
let isTwitchLive = false;
let twitchToken = '';

async function getTwitchToken() {
    try {
        if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return null;
        const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
        const data = await response.json();
        twitchToken = data.access_token;
        return twitchToken;
    } catch (err) { console.error('❌ Błąd pobierania tokenu Twitch:', err); }
}

client.once('ready', async () => {
    console.log(`🤖 Kombajn wjechał na pole! Zalogowano jako: ${client.user.tag}`);

    const commands = [
        { name: 'ban', description: 'Zbanuj użytkownika', options: [ { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true }, { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Za co?', required: true }, { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas', required: false } ] },
        { name: 'kick', description: 'Wyrzuć użytkownika', options: [ { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true }, { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód', required: false } ] },
        { name: 'mute', description: 'Wycisz użytkownika', options: [ { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo?', required: true }, { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas (np. 10m, 1h)', required: true }, { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód', required: false } ] }
    ];
    await client.application.commands.set(commands).catch(console.error);

    // --- AUTOMATYCZNY PANEL TICKETÓW ---
    try {
        const ticketChannel = client.channels.cache.get(CHANNELS.TICKETS);
        if (ticketChannel) {
            const messages = await ticketChannel.messages.fetch({ limit: 10 });
            const hasPanel = messages.some(m => m.author.id === client.user.id && m.components.length > 0);
            
            if (!hasPanel) {
                const ticketEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🎫 Pomoc i Wsparcie')
                    .setDescription('Potrzebujesz pomocy administracji? Kliknij przycisk poniżej, aby utworzyć prywatny kanał rozmowy.\n\n⚠️ **Pamiętaj:** Możesz mieć otwarty tylko **1** ticket naraz!');
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('create_ticket')
                        .setLabel('📩 Utwórz Ticket')
                        .setStyle(ButtonStyle.Success)
                );
                
                await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });
                console.log('✅ Utworzono automatyczny panel ticketów!');
            }
        }
    } catch (err) { console.error('Błąd z panelem ticketów:', err); }

    // --- PĘTLA YOUTUBE (co 5 minut) ---
    setInterval(async () => {
        try {
            if (YOUTUBE_CHANNEL_ID.includes('TUTAJ_WPISZ')) return; 
            const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
            if (feed.items.length > 0) {
                const latestVideo = feed.items[0];
                if (lastVideoId !== latestVideo.id) {
                    if (lastVideoId !== '') { 
                        const channel = client.channels.cache.get(CHANNELS.YT_VIDEO);
                        if (channel) {
                            const embed = new EmbedBuilder().setColor('#ff0000').setTitle('🔴 NOWY FILM NA KANALE!').setDescription(`Właśnie wjechał nowy materiał: **${latestVideo.title}**\n\n🔗 [Oglądaj tutaj!](${latestVideo.link})`).setTimestamp();
                            await channel.send({ content: '@everyone', embeds: [embed] });
                        }
                    }
                    lastVideoId = latestVideo.id; 
                }
            }
        } catch (err) { console.error('Błąd YouTube:', err.message); }
    }, 300000); 

    // --- PĘTLA TWITCH (co 3 minuty) ---
    setInterval(async () => {
        try {
            if (!process.env.TWITCH_CLIENT_ID || TWITCH_USERNAME.includes('TUTAJ_WPISZ')) return;
            if (!twitchToken) await getTwitchToken();
            const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${TWITCH_USERNAME}`, { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${twitchToken}` } });
            if (res.status === 401) { await getTwitchToken(); return; } 
            const data = await res.json();
            const stream = data.data && data.data[0];
            if (stream) {
                if (!isTwitchLive) { 
                    isTwitchLive = true;
                    const channel = client.channels.cache.get(CHANNELS.STREAMS);
                    if (channel) {
                        const embed = new EmbedBuilder().setColor('#9146ff').setTitle('🟪 ODPALAMY STREAMA!').setDescription(`Gramy w **${stream.game_name || 'coś fajnego'}**!\n\n📝 **Temat:** ${stream.title}\n🔗 **[WBIJAJ NA LIVE!](https://twitch.tv/${TWITCH_USERNAME})**`).setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${TWITCH_USERNAME.toLowerCase()}-1280x720.jpg?r=${Math.random()}`).setTimestamp();
                        await channel.send({ content: '@everyone', embeds: [embed] });
                    }
                }
            } else { isTwitchLive = false; }
        } catch (err) { console.error('Błąd Twitch:', err.message); }
    }, 180000); 
});

// POWITANIA I POŻEGNANIA
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

// ==========================================
// OBSŁUGA INTERAKCJI (KOMENDY I PRZYCISKI)
// ==========================================
client.on('interactionCreate', async interaction => {
    
    // --- OBSŁUGA PRZYCISKÓW TICKETÓW ---
    if (interaction.isButton()) {
        
        if (interaction.customId === 'create_ticket') {
            const ticketName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            
            const existingChannel = interaction.guild.channels.cache.find(c => c.name === ticketName);
            if (existingChannel) {
                return interaction.reply({ content: `❌ Masz już otwarty ticket: <#${existingChannel.id}>`, ephemeral: true });
            }

            // Tworzy prywatny kanał w odpowiedniej kategorii
            const ticketChannel = await interaction.guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: CHANNELS.TICKETS_CATEGORY, // <--- Tutaj dodaliśmy kategorię!
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, 
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, 
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, ephemeral: true });

            const insideEmbed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('🎫 Nowy Ticket')
                .setDescription(`Witaj ${interaction.user}!\n\nOpisz swój problem, a administracja wkrótce Ci pomoże. Tylko Ty i administracja macie wgląd w ten kanał.`)
                .setFooter({ text: 'Kliknięcie przycisku "Zamknij" bezpowrotnie skasuje ten kanał.' });
            
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Zamknij Ticket (Tylko Admin)')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `@here`, embeds: [insideEmbed], components: [closeRow] });
        }

        if (interaction.customId === 'close_ticket') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Tylko administracja może zamknąć ten ticket!', ephemeral: true });
            }

            await interaction.reply('🔒 Zamykanie ticketa... Kanał zniknie za 3 sekundy.');
            setTimeout(() => {
                interaction.channel.delete().catch(err => console.error("Nie udało się skasować ticketa", err));
            }, 3000);
        }
    }

    // --- OBSŁUGA KOMEND SLASH (Moderacja) ---
    if (interaction.isChatInputCommand()) {
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
                if (!timeMs) return interaction.reply({ content: '❌ Podaj poprawny czas wyciszenia!', ephemeral: true });
                await targetMember.timeout(timeMs, reason);
                logEmbed.setColor('#00bfff').setTitle('🔇 WYCISZONO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}\n**Czas:** ${timeString}`);
                await interaction.reply({ content: `✅ **${targetMember.user.username}** wyciszony na ${timeString}.`, ephemeral: true });
                if (logChannel) logChannel.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            console.error(error);
            interaction.reply({ content: '❌ Błąd. Sprawdź logi.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);