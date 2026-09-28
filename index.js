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

// Mikro-serwer dla UptimeRobot na Renderze
const app = express();
app.get('/', (req, res) => res.send('Kombajn działa i ma się dobrze!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Serwer podtrzymujący odpalony!'));

// Inicjalizacja bota z odpowiednimi intencjami
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildModeration, // Pozwala na bany, kicki i wyciszenia
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Łączenie z MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Połączono z bazą MongoDB (Bot Widzowie)!'))
    .catch(err => console.error('❌ Błąd bazy danych:', err));

// Gdy bot wystartuje - ładujemy komendy Slash (pod ukośnikiem)
client.once('ready', async () => {
    console.log(`🤖 Kombajn wjechał na pole! Zalogowano jako: ${client.user.tag}`);

    // Rejestracja komend Slash
    const commands = [
        {
            name: 'ban',
            description: 'Zbanuj użytkownika na serwerze',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo zbanować?', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Za co ten ban?', required: true },
                { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas (np. 1d, 1h, 1m, forever)', required: false }
            ]
        },
        {
            name: 'kick',
            description: 'Wyrzuć użytkownika z serwera',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo wyrzucić?', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód wyrzucenia', required: false }
            ]
        },
        {
            name: 'mute',
            description: 'Wycisz użytkownika (Timeout)',
            options: [
                { name: 'uzytkownik', type: ApplicationCommandOptionType.User, description: 'Kogo wyciszyć?', required: true },
                { name: 'czas', type: ApplicationCommandOptionType.String, description: 'Czas (np. 1d, 1h, 1m, 1s)', required: true },
                { name: 'powod', type: ApplicationCommandOptionType.String, description: 'Powód wyciszenia', required: false }
            ]
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Załadowano komendy Slash (/ban, /kick, /mute)!');
    } catch (error) {
        console.error('Błąd ładowania komend:', error);
    }
});

// ==========================================
// KANAŁY - USTAWIENIA ID
// ==========================================
const CHANNELS = {
    WELCOME: '1279161469132341428',
    LEAVE: '1279161514670162082',
    ADMIN_CMDS: '1256544039579156541',
    MOD_LOGS: '1256544115517292616'
};

// ==========================================
// SYSTEM POWITAŃ I POŻEGNAŃ
// ==========================================
client.on('guildMemberAdd', member => {
    const channel = member.guild.channels.cache.get(CHANNELS.WELCOME);
    if (!channel) return;

    const welcomeEmbed = new EmbedBuilder()
        .setColor('#00e676')
        .setTitle(`👋 Witamy na serwerze!`)
        .setDescription(`Siemano **${member.user.username}**! Fajnie, że wpadłeś. Rozgość się!`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: `Jesteś naszym ${member.guild.memberCount}. użytkownikiem!` })
        .setTimestamp();

    channel.send({ embeds: [welcomeEmbed] });
});

client.on('guildMemberRemove', member => {
    const channel = member.guild.channels.cache.get(CHANNELS.LEAVE);
    if (!channel) return;

    const leaveEmbed = new EmbedBuilder()
        .setColor('#ff3333')
        .setTitle(`😢 Ktoś nas opuścił...`)
        .setDescription(`**${member.user.username}** poszedł sobie w siną dal.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTimestamp();

    channel.send({ embeds: [leaveEmbed] });
});

// ==========================================
// SYSTEM KOMEND SLASH (Moderacja)
// ==========================================

// Funkcja zamieniająca tekst (np. "1d", "2h") na milisekundy
function parseTimeToMs(timeStr) {
    if (!timeStr || timeStr.toLowerCase() === 'forever') return null;
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return null;
    
    const val = parseInt(match[1]);
    const unit = match[2];
    
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return null;
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // BLOKADA: Sprawdzamy, czy komenda została użyta na kanale administracyjnym
    if (interaction.channelId !== CHANNELS.ADMIN_CMDS) {
        return interaction.reply({ 
            content: `🚫 Tych komend możesz używać **tylko** na kanale <#${CHANNELS.ADMIN_CMDS}>!`, 
            ephemeral: true 
        });
    }

    // BLOKADA: Uprawnienia administratora
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Brak uprawnień!', ephemeral: true });
    }

    const command = interaction.commandName;
    const targetMember = interaction.options.getMember('uzytkownik');
    const reason = interaction.options.getString('powod') || 'Brak powodu';
    const timeString = interaction.options.getString('czas');
    const logChannel = interaction.guild.channels.cache.get(CHANNELS.MOD_LOGS);

    if (!targetMember) {
        return interaction.reply({ content: '❌ Nie znalazłem takiego użytkownika na serwerze.', ephemeral: true });
    }
    
    // Zabezpieczenie, żeby bot nie wywalił samego siebie lub Ciebie
    if (!targetMember.manageable || !targetMember.bannable) {
        return interaction.reply({ content: '❌ Ten użytkownik ma zbyt wysoką rolę, bym mógł coś z nim zrobić!', ephemeral: true });
    }

    // Embed z wyrokiem do wysłania na kanał z logami
    const logEmbed = new EmbedBuilder()
        .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Wykonane przez: ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

    try {
        if (command === 'ban') {
            const timeMs = parseTimeToMs(timeString);
            
            await targetMember.ban({ reason });
            logEmbed.setColor('#000000').setTitle('🔨 ZBANOWANO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}\n**Czas:** ${timeString || 'Zawsze (forever)'}`);
            
            // Jeśli podano czas (np. 1d), bot zdejmie bana po tym czasie
            if (timeMs) {
                setTimeout(async () => {
                    await interaction.guild.members.unban(targetMember.id).catch(() => {});
                }, timeMs);
            }

            await interaction.reply({ content: `✅ **${targetMember.user.username}** dostał bana z plaskacza.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }

        if (command === 'kick') {
            await targetMember.kick(reason);
            logEmbed.setColor('#ff9900').setTitle('👢 WYRZUCONO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}`);
            
            await interaction.reply({ content: `✅ **${targetMember.user.username}** został wykopany z serwera.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }

        if (command === 'mute') {
            const timeMs = parseTimeToMs(timeString);
            if (!timeMs) return interaction.reply({ content: '❌ Podaj poprawny czas wyciszenia! Np. 10m, 1h, 1d (maks 28 dni).', ephemeral: true });

            await targetMember.timeout(timeMs, reason);
            logEmbed.setColor('#00bfff').setTitle('🔇 WYCISZONO GRACZA').setDescription(`**Gracz:** ${targetMember}\n**Powód:** ${reason}\n**Czas:** ${timeString}`);
            
            await interaction.reply({ content: `✅ **${targetMember.user.username}** dostał knebel na ${timeString}.`, ephemeral: true });
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
        }

    } catch (error) {
        console.error(error);
        interaction.reply({ content: '❌ Wystąpił błąd podczas wykonywania tej akcji. Sprawdź logi.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);