const USER_1_RSN = "Duo Ely";
const USER_2_RSN = "Duo Lucian";
const RESET_HOUR = 12;
const SKILL_DATA = [
    { name: "Overall", wikiName: "Overall" },
    { name: "Attack", wikiName: "Attack" },
    { name: "Defence", wikiName: "Defence" },
    { name: "Strength", wikiName: "Strength" },
    { name: "Hitpoints", wikiName: "Hitpoints" },
    { name: "Ranged", wikiName: "Ranged" },
    { name: "Prayer", wikiName: "Prayer" },
    { name: "Magic", wikiName: "Magic" },
    { name: "Cooking", wikiName: "Cooking" },
    { name: "Woodcutting", wikiName: "Woodcutting" },
    { name: "Fletching", wikiName: "Fletching" },
    { name: "Fishing", wikiName: "Fishing" },
    { name: "Firemaking", wikiName: "Firemaking" },
    { name: "Crafting", wikiName: "Crafting" },
    { name: "Smithing", wikiName: "Smithing" },
    { name: "Mining", wikiName: "Mining" },
    { name: "Herblore", wikiName: "Herblore" },
    { name: "Agility", wikiName: "Agility" },
    { name: "Thieving", wikiName: "Thieving" },
    { name: "Slayer", wikiName: "Slayer" },
    { name: "Farming", wikiName: "Farming" },
    { name: "Runecrafting", wikiName: "Runecraft" },
    { name: "Hunter", wikiName: "Hunter" },
    { name: "Construction", wikiName: "Construction" },
    { name: "Sailing", wikiName: "Sailing" }
];

const ICON_SIZE = "21px";
const API_BASE_URL = "https://corsproxy.io/?url=http://services.runescape.com/m=hiscore_oldschool/index_lite.ws?player=";
const ICON_BASE_URL = "https://oldschool.runescape.wiki/images/thumb/";
const SKILL_TOTAL_ICON = "https://oldschool.runescape.wiki/images/Stats_icon.png?1b467";
const MAX_LEVEL_XP = 13034431;

// --- Period Key Calculations ---

function getDailyPeriodKey() {
    const now = new Date();
    const calcDate = new Date(now.getTime());
    if (calcDate.getHours() < RESET_HOUR) {
        calcDate.setDate(calcDate.getDate() - 1);
    }
    return `${calcDate.getFullYear()}-${calcDate.getMonth()}-${calcDate.getDate()}`;
}

function getWeeklyPeriodKey() {
    const now = new Date();
    const calcDate = new Date(now.getTime());
    if (calcDate.getHours() < RESET_HOUR) {
        calcDate.setDate(calcDate.getDate() - 1);
    }
    // Set to Monday of the current week
    const day = calcDate.getDay();
    const diff = calcDate.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(calcDate.setDate(diff));
    return `W-${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
}

function getMonthlyPeriodKey() {
    const now = new Date();
    const calcDate = new Date(now.getTime());
    if (calcDate.getDate() === 1 && calcDate.getHours() < RESET_HOUR) {
        calcDate.setDate(0); // Shunt to the last day of the previous month
    }
    return `${calcDate.getFullYear()}-${calcDate.getMonth()}`;
}

// --- Highscores Logic ---

function getIconUrl(wikiName) {
    if (wikiName == "Overall"){
        return SKILL_TOTAL_ICON;
    }
    const filename = `${wikiName}_icon.png`;
    const encodedFilename = filename.replace(/ /g, "_");
    return `${ICON_BASE_URL}${encodedFilename}/${ICON_SIZE}-${encodedFilename}`;
}

async function fetchHiscores(username) {
    const url = API_BASE_URL + encodeURIComponent(username);
    const response = await fetch(url);

    if (!response.ok || response.status === 404) {
        throw new Error("Error with API or fetching username");
    }

    const csvText = await response.text();
    return parseCSVToSkills(csvText);
}

function getComparisonColor(user1Exp, user2Exp) {
    const exp1 = user1Exp > 0 ? user1Exp : 0;
    const exp2 = user2Exp > 0 ? user2Exp : 0;

    const COLOR_RED = [255, 74, 74];
    const COLOR_WHITE_TIE = [255, 255, 255]; 
    const COLOR_GREEN = [74, 255, 74]; 

    if (exp1 === 0 && exp2 === 0) return "rgb(255, 255, 255)"; 
    if (exp1 === exp2) return "rgb(255, 255, 255)";

    const ratio1 = Math.min(1, exp1 / MAX_LEVEL_XP);
    const ratio2 = Math.min(1, exp2 / MAX_LEVEL_XP);
    const differential = ratio1 - ratio2;
    const blendFactor = (differential + 1) / 2;

    let r, g, b;

    if (blendFactor <= 0.5) {
        const localFactor = blendFactor * 2;
        r = Math.round(COLOR_RED[0] + (COLOR_WHITE_TIE[0] - COLOR_RED[0]) * localFactor);
        g = Math.round(COLOR_RED[1] + (COLOR_WHITE_TIE[1] - COLOR_RED[1]) * localFactor);
        b = Math.round(COLOR_RED[2] + (COLOR_WHITE_TIE[2] - COLOR_RED[2]) * localFactor);
    } else {
        const localFactor = (blendFactor - 0.5) * 2;
        r = Math.round(COLOR_WHITE_TIE[0] + (COLOR_GREEN[0] - COLOR_WHITE_TIE[0]) * localFactor);
        g = Math.round(COLOR_WHITE_TIE[1] + (COLOR_GREEN[1] - COLOR_WHITE_TIE[1]) * localFactor);
        b = Math.round(COLOR_WHITE_TIE[2] + (COLOR_GREEN[2] - COLOR_WHITE_TIE[2]) * localFactor);
    }

    return `rgb(${r}, ${g}, ${b})`;
}

function parseCSVToSkills(csvText){
    const lines = csvText.trim().split("\n");
    const skillsData = [];

    for (let i = 0; i < SKILL_DATA.length && i < lines.length; i++) {
        const skillInfo = SKILL_DATA[i];
        const parts = lines[i].split(",");
        const rank = parseInt(parts[0] || 0);
        const level = parseInt(parts[1] || 0); 
        const exp = parseInt(parts[2] || 0);

        const skillObject = { 
            name: skillInfo.name,
            wikiName: skillInfo.wikiName,
            rank: rank.toLocaleString(),
            level: level.toLocaleString(),
            rawLevel: level, // Added for level math
            exp: exp.toLocaleString(),
            rawExp: exp
        };
        skillsData.push(skillObject);
    }
    return skillsData;
}

// --- Local Storage Handlers ---

function saveBaselines(username, baselinesObj) {
    try {
        localStorage.setItem(`osrs_tracking_baselines_${username.replace(/ /g, '_')}`, JSON.stringify(baselinesObj));
    } catch (e) {
        console.error("Could not save to localStorage:", e);
    }
}

function loadBaselines(username) {
    try {
        const data = localStorage.getItem(`osrs_tracking_baselines_${username.replace(/ /g, '_')}`);
        return data ? JSON.parse(data) : { daily: null, weekly: null, monthly: null };
    } catch (e) {
        console.error("Could not load from localStorage:", e);
        return { daily: null, weekly: null, monthly: null };
    }
}

// --- Display Rendering ---

function compareAndPrepareDisplayData(currentData, baselines) {
    const displayData = [];
    for (let i = 0; i < currentData.length; i++) {
        const currentSkill = currentData[i];
        let dailyExp = 0, weeklyExp = 0, monthlyExp = 0;
        let dailyLvl = 0, weeklyLvl = 0, monthlyLvl = 0;

        // Treat unranked (-1) levels as 1 for accurate calculation
        const currentLvlCalc = currentSkill.rawLevel < 1 ? 1 : currentSkill.rawLevel;

        if (baselines.daily && baselines.daily.skills[i]) {
            const baseLvlCalc = baselines.daily.skills[i].rawLevel < 1 ? 1 : baselines.daily.skills[i].rawLevel;
            dailyExp = Math.max(0, currentSkill.rawExp - baselines.daily.skills[i].rawExp);
            dailyLvl = Math.max(0, currentLvlCalc - baseLvlCalc);
        }
        if (baselines.weekly && baselines.weekly.skills[i]) {
            const baseLvlCalc = baselines.weekly.skills[i].rawLevel < 1 ? 1 : baselines.weekly.skills[i].rawLevel;
            weeklyExp = Math.max(0, currentSkill.rawExp - baselines.weekly.skills[i].rawExp);
            weeklyLvl = Math.max(0, currentLvlCalc - baseLvlCalc);
        }
        if (baselines.monthly && baselines.monthly.skills[i]) {
            const baseLvlCalc = baselines.monthly.skills[i].rawLevel < 1 ? 1 : baselines.monthly.skills[i].rawLevel;
            monthlyExp = Math.max(0, currentSkill.rawExp - baselines.monthly.skills[i].rawExp);
            monthlyLvl = Math.max(0, currentLvlCalc - baseLvlCalc);
        }

        displayData.push({
            ...currentSkill,
            dailyExp: dailyExp,
            dailyLvl: dailyLvl,
            weeklyExp: weeklyExp,
            weeklyLvl: weeklyLvl,
            monthlyExp: monthlyExp,
            monthlyLvl: monthlyLvl
        });
    }
    return displayData;
}

function formatGainDisplay(xpAmt, lvlAmt) {
    if (xpAmt === 0) return '-';
    
    const xpStr = `+${xpAmt.toLocaleString()}`;
    // Only show the level gain pipe if levels were actually gained
    return lvlAmt > 0 ? `${xpStr} | +${lvlAmt}` : xpStr;
}

function getXpClass(xpAmt) {
    return xpAmt > 0 ? "recent-xp-gain" : "recent-xp-none";
}

function renderTable(elementId, data, opponentData) {
    const container = document.getElementById(elementId);
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th style="text-align:left;">Skill</th>
                    <th>Lvl</th>
                    <th>Experience</th>
                    <th>Day</th>
                    <th>Week</th>
                    <th>Month</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach((skill, index) => {
        let colorStyle = "";
        
        if (opponentData && index < opponentData.length) {
            const calculatedColor = getComparisonColor(skill.rawExp, opponentData[index].rawExp);
            colorStyle = `style="color: ${calculatedColor} !important;"`;
        }

        html += `
            <tr>
                <td class="skill-name-cell">
                    <img src="${getIconUrl(skill.wikiName)}" class="skill-icon" alt="${skill.name} icon">
                    <span>${skill.name}</span>
                </td>
                <td ${colorStyle}>${skill.level}</td>
                <td ${colorStyle}>${skill.exp === '-1' || skill.exp === '0' ? 'N/A' : skill.exp}</td>
                <td class="${getXpClass(skill.dailyExp)}">${formatGainDisplay(skill.dailyExp, skill.dailyLvl)}</td>
                <td class="${getXpClass(skill.weeklyExp)}">${formatGainDisplay(skill.weeklyExp, skill.weeklyLvl)}</td>
                <td class="${getXpClass(skill.monthlyExp)}">${formatGainDisplay(skill.monthlyExp, skill.monthlyLvl)}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

async function fetchAndDisplayScores() {
    const userRsnClean = USER_1_RSN.replace(/ /g, '+');
    const friendRsnClean = USER_2_RSN.replace(/ /g, '+');
    
    document.getElementById('user-title').textContent = `${USER_1_RSN}'s Highscores`;
    document.getElementById('friend-title').textContent = `${USER_2_RSN}'s Highscores`;

    const keys = {
        daily: getDailyPeriodKey(),
        weekly: getWeeklyPeriodKey(),
        monthly: getMonthlyPeriodKey()
    };

    let u1Baselines = loadBaselines(USER_1_RSN);
    let u2Baselines = loadBaselines(USER_2_RSN);
    
    let u1_live = null;
    let u2_live = null;

    const [userPromise, friendPromise] = await Promise.allSettled([
        fetchHiscores(userRsnClean),
        fetchHiscores(friendRsnClean)
    ]);

    // Handle User 1
    if (userPromise.status === 'fulfilled') {
        u1_live = userPromise.value;
        let needsSave = false;

        if (!u1Baselines.daily || u1Baselines.daily.period !== keys.daily) {
            u1Baselines.daily = { period: keys.daily, skills: u1_live }; needsSave = true;
        }
        if (!u1Baselines.weekly || u1Baselines.weekly.period !== keys.weekly) {
            u1Baselines.weekly = { period: keys.weekly, skills: u1_live }; needsSave = true;
        }
        if (!u1Baselines.monthly || u1Baselines.monthly.period !== keys.monthly) {
            u1Baselines.monthly = { period: keys.monthly, skills: u1_live }; needsSave = true;
        }
        if (needsSave) saveBaselines(USER_1_RSN, u1Baselines);
    } else {
        const message = `<p class="error-message">Highscores not found for **${USER_1_RSN}**. Check spelling.</p>`;
        document.getElementById('user-hiscores-table').innerHTML = message;
        console.error(`Error fetching user scores for ${USER_1_RSN}:`, userPromise.reason);
    }

    // Handle User 2 
    if (friendPromise.status === 'fulfilled') {
        u2_live = friendPromise.value;
        let needsSave = false;

        if (!u2Baselines.daily || u2Baselines.daily.period !== keys.daily) {
            u2Baselines.daily = { period: keys.daily, skills: u2_live }; needsSave = true;
        }
        if (!u2Baselines.weekly || u2Baselines.weekly.period !== keys.weekly) {
            u2Baselines.weekly = { period: keys.weekly, skills: u2_live }; needsSave = true;
        }
        if (!u2Baselines.monthly || u2Baselines.monthly.period !== keys.monthly) {
            u2Baselines.monthly = { period: keys.monthly, skills: u2_live }; needsSave = true;
        }
        if (needsSave) saveBaselines(USER_2_RSN, u2Baselines);
    } else {
        const message = `<p class="error-message">Highscores not found for **${USER_2_RSN}**. Check spelling.</p>`;
        document.getElementById('friend-hiscores-table').innerHTML = message;
        console.error(`Error fetching friend scores for ${USER_2_RSN}:`, friendPromise.reason);
    }
    
    // Render
    if (u1_live && u2_live) {
        const u1DisplayData = compareAndPrepareDisplayData(u1_live, u1Baselines);
        const u2DisplayData = compareAndPrepareDisplayData(u2_live, u2Baselines);
        renderTable('user-hiscores-table', u1DisplayData, u2DisplayData); 
        renderTable('friend-hiscores-table', u2DisplayData, u1DisplayData);
    }
}

fetchAndDisplayScores();