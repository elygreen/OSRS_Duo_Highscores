import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc,
         deleteDoc, updateDoc, doc, getDoc, setDoc,
         onSnapshot, serverTimestamp,
         query, orderBy }                         from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey:            "AIzaSyDAT1UIM1mFMH1vh_Wal4SqXOY6NSr0_6c",
    authDomain:        "castle-mtg-stat-tracker.firebaseapp.com",
    projectId:         "castle-mtg-stat-tracker",
    storageBucket:     "castle-mtg-stat-tracker.firebasestorage.app",
    messagingSenderId: "503581755862",
    appId:             "1:503581755862:web:10222b71ae270b6ca03c77"
};

const _fbApp    = initializeApp(firebaseConfig, "osrs-tasks");
const _db       = getFirestore(_fbApp);
const _tasksCol = collection(_db, "osrs_duo_tasks");

const USER_1_RSN = "Duo Ely";
const USER_2_RSN = "Duo Lucian";
const RESET_HOUR = 5;
const WIKI_NAME_OVERRIDES = { Runecrafting: "Runecraft" };
const SKILL_DATA = [
    "Overall","Attack","Defence","Strength","Hitpoints","Ranged","Prayer","Magic",
    "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting","Smithing",
    "Mining","Herblore","Agility","Thieving","Slayer","Farming","Runecrafting",
    "Hunter","Construction","Sailing"
].map(name => ({ name, wikiName: WIKI_NAME_OVERRIDES[name] ?? name }));

const ICON_SIZE = "21px";
const API_BASE_URL = "https://services.runescape.com/m=hiscore_oldschool/index_lite.ws?player=";
const ICON_BASE_URL = "https://oldschool.runescape.wiki/images/thumb/";
const SKILL_TOTAL_ICON = "https://oldschool.runescape.wiki/images/Stats_icon.png?1b467";
const MAX_LEVEL_XP = 13034431;

// --- Period Key Calculations ---

function getAdjustedDate() {
    const d = new Date();
    if (d.getHours() < RESET_HOUR) d.setDate(d.getDate() - 1);
    return d;
}

function getDailyPeriodKey() {
    const d = getAdjustedDate();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getWeeklyPeriodKey() {
    const d = getAdjustedDate();
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // snap to Monday
    return `W-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getMonthlyPeriodKey() {
    const d = new Date();
    if (d.getDate() === 1 && d.getHours() < RESET_HOUR) d.setDate(0);
    return `${d.getFullYear()}-${d.getMonth()}`;
}

// --- Highscores Logic ---

function getIconUrl(wikiName) {
    if (wikiName === "Overall") return SKILL_TOTAL_ICON;
    const filename = `${wikiName}_icon.png`;
    return `${ICON_BASE_URL}${filename}/${ICON_SIZE}-${filename}`;
}

async function fetchHiscores(username) {
    // Append a unique timestamp (&cb=...) to force the proxy to pull fresh data
    const targetUrl = `${API_BASE_URL}${encodeURIComponent(username)}&cb=${Date.now()}`;
    const url = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(url);

    if (!response.ok || response.status === 404) {
        throw new Error("Error with API or fetching username");
    }

    const csvText = await response.text();
    return parseCSVToSkills(csvText);
}

function getProgressColor(exp) {
    const safeExp = exp > 0 ? exp : 0;
    const MIDPOINT_XP = 1210421;   // Experience required for Level 75
    let ratio;
    
    // Piecewise calculation to force Level 75 to act as the 50% ratio mark
    if (safeExp <= MIDPOINT_XP) {
        ratio = (safeExp / MIDPOINT_XP) * 0.5;
    } else {
        ratio = 0.5 + ((safeExp - MIDPOINT_XP) / (MAX_LEVEL_XP - MIDPOINT_XP)) * 0.5;
    }

    // Cap the ratio at 1 so anything past level 99 stays full green
    ratio = Math.min(1, ratio);

    const COLOR_RED = [255, 74, 74];
    const COLOR_WHITE = [255, 255, 255]; 
    const COLOR_GREEN = [74, 255, 74]; 

    let r, g, b;

    if (ratio <= 0.5) {
        // Map 0 - Level 75 progress to a Red -> White gradient
        const localFactor = ratio * 2; 
        r = Math.round(COLOR_RED[0] + (COLOR_WHITE[0] - COLOR_RED[0]) * localFactor);
        g = Math.round(COLOR_RED[1] + (COLOR_WHITE[1] - COLOR_RED[1]) * localFactor);
        b = Math.round(COLOR_RED[2] + (COLOR_WHITE[2] - COLOR_RED[2]) * localFactor);
    } else {
        // Map Level 75 - Level 99 progress to a White -> Green gradient
        const localFactor = (ratio - 0.5) * 2; 
        r = Math.round(COLOR_WHITE[0] + (COLOR_GREEN[0] - COLOR_WHITE[0]) * localFactor);
        g = Math.round(COLOR_WHITE[1] + (COLOR_GREEN[1] - COLOR_WHITE[1]) * localFactor);
        b = Math.round(COLOR_WHITE[2] + (COLOR_GREEN[2] - COLOR_WHITE[2]) * localFactor);
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
            rank: formatNumber(rank),
            level: level.toLocaleString(),
            rawLevel: level,
            exp: exp.toLocaleString(),
            rawExp: exp
        };
        skillsData.push(skillObject);
    }
    return skillsData;
}

// --- Firestore Baseline Handlers ---

async function saveBaselines(username, baselinesObj) {
    try {
        const key = username.replace(/ /g, '_');
        await setDoc(doc(_db, "osrs_baselines", key), baselinesObj);
    } catch (e) {
        console.error("Could not save baselines to Firestore:", e);
    }
}

async function loadBaselines(username) {
    try {
        const key = username.replace(/ /g, '_');
        const snap = await getDoc(doc(_db, "osrs_baselines", key));
        if (!snap.exists()) return { daily: null, weekly: null, monthly: null };
        const data = snap.data();
        // Firestore stores arrays as numeric-keyed maps — convert back to real arrays
        for (const period of ['daily', 'weekly', 'monthly']) {
            if (data[period]?.skills && !Array.isArray(data[period].skills)) {
                data[period].skills = Object.keys(data[period].skills)
                    .sort((a, b) => Number(a) - Number(b))
                    .map(k => data[period].skills[k]);
            }
        }
        return data;
    } catch (e) {
        console.error("Could not load baselines from Firestore:", e);
        return { daily: null, weekly: null, monthly: null };
    }
}

// --- Baseline Helpers ---

/**
 * Checks each period baseline against the current period keys.
 * If a baseline is missing or stale, it is replaced with the live data snapshot.
 * Returns true if any baseline was updated (so the caller knows to save).
 */
function isBaselineValid(baseline, expectedPeriod) {
    return baseline &&
           baseline.period === expectedPeriod &&
           Array.isArray(baseline.skills) &&
           baseline.skills.length > 0;
}

function refreshBaselinesIfNeeded(baselines, keys, liveSkills) {
    let needsSave = false;
    if (!isBaselineValid(baselines.daily, keys.daily)) {
        baselines.daily = { period: keys.daily, skills: liveSkills };
        needsSave = true;
    }
    if (!isBaselineValid(baselines.weekly, keys.weekly)) {
        baselines.weekly = { period: keys.weekly, skills: liveSkills };
        needsSave = true;
    }
    if (!isBaselineValid(baselines.monthly, keys.monthly)) {
        baselines.monthly = { period: keys.monthly, skills: liveSkills };
        needsSave = true;
    }
    return needsSave;
}

// --- Rank History ---

async function recordRankHistory(rankNum) {
    // Write one document per day keyed by the daily period — safe to call every load,
    // it only writes if today's entry doesn't exist yet.
    try {
        const key = getDailyPeriodKey();
        const ref = doc(_db, "osrs_rank_history", key);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            // Store a real timestamp so we can sort chronologically
            const d = getAdjustedDate();
            await setDoc(ref, {
                rank: rankNum,
                ts: Date.now(),
                label: `${d.getDate()}/${d.getMonth() + 1}`
            });
        }
    } catch (e) {
        console.error("Could not record rank history:", e);
    }
}

async function loadRankHistory() {
    try {
        const { getDocs, collection: fsCol, query: fsQuery, orderBy: fsOrderBy, limit: fsLimit }
            = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const snap = await getDocs(
            fsQuery(fsCol(_db, "osrs_rank_history"), fsOrderBy("ts", "asc"), fsLimit(90))
        );
        return snap.docs.map(d => d.data());
    } catch (e) {
        console.error("Could not load rank history:", e);
        return [];
    }
}

function renderRankChart(history) {
    const canvas  = document.getElementById('rank-chart');
    const empty   = document.getElementById('rank-chart-empty');

    if (!history || history.length < 2) {
        canvas.style.display = 'none';
        empty.style.display  = 'block';
        return;
    }

    canvas.style.display = 'block';
    empty.style.display  = 'none';

    // Size canvas to its CSS dimensions at device pixel ratio for sharpness
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight || 90;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 36, right: 8, bottom: 16, left: 8 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top  - PAD.bottom;

    const ranks  = history.map(h => h.rank);
    const minR   = Math.min(...ranks);
    const maxR   = Math.max(...ranks);
    const spread = maxR - minR || 1;

    // Lower rank number = better, so flip Y: rank minR → top of chart
    const toX = i => PAD.left + (i / (history.length - 1)) * cW;
    const toY = r => PAD.top  + ((r - minR) / spread) * cH;

    // Precompute point positions for hit-testing
    const points = history.map((h, i) => ({ x: toX(i), y: toY(h.rank), rank: h.rank, label: h.label }));

    function drawChart(hoveredIdx) {
        ctx.clearRect(0, 0, W, H);

        // Grid lines
        ctx.strokeStyle = 'rgba(90,75,51,0.5)';
        ctx.lineWidth   = 1;
        const gridSteps = 4;
        for (let i = 0; i <= gridSteps; i++) {
            const y = PAD.top + (i / gridSteps) * cH;
            ctx.beginPath();
            ctx.moveTo(PAD.left, y);
            ctx.lineTo(PAD.left + cW, y);
            ctx.stroke();

        }

        // Crosshair vertical line for hovered point
        if (hoveredIdx !== null) {
            const hx = points[hoveredIdx].x;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,152,31,0.25)';
            ctx.lineWidth   = 1;
            ctx.setLineDash([4, 3]);
            ctx.moveTo(hx, PAD.top);
            ctx.lineTo(hx, PAD.top + cH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Line
        ctx.beginPath();
        ctx.strokeStyle = '#ff981f';
        ctx.lineWidth   = 2.5;
        ctx.lineJoin    = 'round';
        history.forEach((h, i) => {
            i === 0 ? ctx.moveTo(toX(i), toY(h.rank)) : ctx.lineTo(toX(i), toY(h.rank));
        });
        ctx.stroke();

        // Fill under line
        ctx.lineTo(toX(history.length - 1), PAD.top + cH);
        ctx.lineTo(toX(0), PAD.top + cH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,152,31,0.10)';
        ctx.fill();

        // Dots + X labels
        history.forEach((h, i) => {
            const { x, y } = points[i];
            const isHovered = i === hoveredIdx;

            ctx.beginPath();
            ctx.arc(x, y, isHovered ? 6 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle   = isHovered ? 'gold' : '#ff981f';
            ctx.strokeStyle = '#2a1e08';
            ctx.lineWidth   = isHovered ? 2 : 1.5;
            ctx.fill();
            ctx.stroke();

            // X axis date label — show every label if few points, else thin out
            const showLabel = history.length <= 14 || i % Math.ceil(history.length / 14) === 0 || i === history.length - 1;
            if (showLabel) {
                ctx.fillStyle    = isHovered ? '#ff981f' : '#7a6642';
                ctx.font         = isHovered ? 'bold 10px monospace' : '10px monospace';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(h.label, x, PAD.top + cH + 6);
            }
        });

        // Tooltip for hovered point
        if (hoveredIdx !== null) {
            const pt  = points[hoveredIdx];
            const txt = `Rank ${pt.rank.toLocaleString()}  •  ${pt.label}`;

            ctx.font = 'bold 12px monospace';
            const TW  = ctx.measureText(txt).width;
            const TPW = TW + 16;
            const TPH = 24;
            const TPR = 4; // corner radius

            // Position: above the dot, clamped within canvas
            let tx = pt.x - TPW / 2;
            tx = Math.max(PAD.left, Math.min(tx, W - PAD.right - TPW));
            const ty = Math.max(PAD.top, pt.y - TPH - 10);

            // Box
            ctx.beginPath();
            ctx.moveTo(tx + TPR, ty);
            ctx.lineTo(tx + TPW - TPR, ty);
            ctx.arcTo(tx + TPW, ty, tx + TPW, ty + TPR, TPR);
            ctx.lineTo(tx + TPW, ty + TPH - TPR);
            ctx.arcTo(tx + TPW, ty + TPH, tx + TPW - TPR, ty + TPH, TPR);
            ctx.lineTo(tx + TPR, ty + TPH);
            ctx.arcTo(tx, ty + TPH, tx, ty + TPH - TPR, TPR);
            ctx.lineTo(tx, ty + TPR);
            ctx.arcTo(tx, ty, tx + TPR, ty, TPR);
            ctx.closePath();
            ctx.fillStyle   = '#1e1200';
            ctx.strokeStyle = '#ff981f';
            ctx.lineWidth   = 1.5;
            ctx.fill();
            ctx.stroke();

            // Text
            ctx.fillStyle    = 'gold';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, tx + 8, ty + TPH / 2);
        }
    }

    // Initial draw
    drawChart(null);

    // Hover interaction — find the nearest point within a snap radius
    const SNAP_PX = 30;

    function onMouseMove(e) {
        const rect   = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const mx     = (e.clientX - rect.left) * scaleX;
        const my     = (e.clientY - rect.top)  * scaleX;

        let closest = null;
        let minDist = Infinity;
        points.forEach((pt, i) => {
            const d = Math.hypot(mx - pt.x, my - pt.y);
            if (d < minDist) { minDist = d; closest = i; }
        });

        const hit = minDist <= SNAP_PX ? closest : null;
        canvas.style.cursor = hit !== null ? 'pointer' : 'default';
        drawChart(hit);
    }

    function onMouseLeave() {
        canvas.style.cursor = 'default';
        drawChart(null);
    }

    // Remove any previously attached listeners before re-attaching
    canvas._rankMoveHandler  && canvas.removeEventListener('mousemove',  canvas._rankMoveHandler);
    canvas._rankLeaveHandler && canvas.removeEventListener('mouseleave', canvas._rankLeaveHandler);
    canvas._rankMoveHandler  = onMouseMove;
    canvas._rankLeaveHandler = onMouseLeave;
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
}

// --- Display Rendering ---

function compareAndPrepareDisplayData(currentData, baselines) {
    return currentData.map((currentSkill, i) => {
        const currentLvlCalc = Math.max(1, currentSkill.rawLevel);
        const gains = {};
        for (const period of ['daily', 'weekly', 'monthly']) {
            const base = baselines[period]?.skills[i];
            gains[`${period}Exp`] = base ? Math.max(0, currentSkill.rawExp - base.rawExp) : 0;
            gains[`${period}Lvl`] = base ? Math.max(0, currentLvlCalc - Math.max(1, base.rawLevel)) : 0;
        }
        return { ...currentSkill, ...gains };
    });
}

function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'm';
    if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
}

function formatGainDisplay(xpAmt, lvlAmt) {
    if (xpAmt === 0) return '-';
    const xpStr = `+${formatNumber(xpAmt)}`;
    return lvlAmt > 0
        ? `${xpStr} <span style="color: gold;">(+${lvlAmt})</span>`
        : xpStr;
}

function getXpClass(xpAmt) {
    return xpAmt > 0 ? "recent-xp-gain" : "recent-xp-none";
}

function renderTable(elementId, data) {
    const container = document.getElementById(elementId);
    
    let html = `
        <table>
            <colgroup>
                <col style="width: 16%">
                <col style="width: 8%">
                <col style="width: 16%">
                <col style="width: 16%">
                <col style="width: 16%">
                <col style="width: 16%">
            </colgroup>
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

    data.forEach((skill) => {
        const calculatedColor = getProgressColor(skill.rawExp);

        html += `
            <tr>
                <td class="skill-name-cell">
                    <img src="${getIconUrl(skill.wikiName)}" class="skill-icon" alt="${skill.name} icon">
                    <span>${skill.name}</span>
                </td>
                <td class="skill-progress-cell" style="--skill-color: ${calculatedColor}">${skill.level}</td>
                <td class="skill-progress-cell" style="--skill-color: ${calculatedColor}">${skill.rawExp <= 0 ? 'N/A' : skill.exp}</td>
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
    document.getElementById('user-title').textContent = `${USER_1_RSN}'s Highscores`;
    document.getElementById('friend-title').textContent = `${USER_2_RSN}'s Highscores`;

    const keys = {
        daily: getDailyPeriodKey(),
        weekly: getWeeklyPeriodKey(),
        monthly: getMonthlyPeriodKey()
    };

    // Fetch hiscores, baselines, and group rank all in parallel
    const players = [
        { rsn: USER_1_RSN, tableId: 'user-hiscores-table' },
        { rsn: USER_2_RSN, tableId: 'friend-hiscores-table' },
    ];

    const [rankText, ...playerData] = await Promise.all([
        fetchGroupRank("Castle Duo"),
        ...players.map(async p => ({
            baselines: await loadBaselines(p.rsn),
            live: await fetchHiscores(p.rsn.replace(/ /g, '+')).catch(err => { console.error(`Error fetching scores for ${p.rsn}:`, err); return null; })
        }))
    ]);

    // Group rank display
    const groupRankElement = document.getElementById('group-rank');
    if (groupRankElement) {
        let rankDiffDisplay = "";
        const currentRankNum = parseInt(rankText.replace(/,/g, ''));

        if (!isNaN(currentRankNum)) {
            // Record today's rank for the history chart (no-op if already written today)
            recordRankHistory(currentRankNum);

            const dailyKey = getDailyPeriodKey();
            let groupBaseline = null;
            try {
                const snap = await getDoc(doc(_db, "osrs_baselines", "group_Castle_Duo"));
                if (snap.exists()) groupBaseline = snap.data();
            } catch (e) {
                console.error("Could not load group baseline:", e);
            }

            if (!groupBaseline || groupBaseline.period !== dailyKey) {
                try {
                    await setDoc(doc(_db, "osrs_baselines", "group_Castle_Duo"), { period: dailyKey, rank: currentRankNum });
                } catch (e) {
                    console.error("Could not save group baseline:", e);
                }
            } else {
                const rankDiff = groupBaseline.rank - currentRankNum;
                if (rankDiff > 0) {
                    rankDiffDisplay = ` <span style="color: #00eeff; font-size: 0.85em;">(+${rankDiff.toLocaleString()})</span>`;
                } else if (rankDiff < 0) {
                    rankDiffDisplay = ` <span style="color: #ff4d4d; font-size: 0.85em;">(${rankDiff.toLocaleString()})</span>`;
                } else {
                    rankDiffDisplay = ` <span style="color: #ffffff; font-size: 0.85em;">(+0)</span>`;
                }
            }
        }

        groupRankElement.innerHTML = `Castle Duo Rank: <span style="color: gold;">${rankText}</span>${rankDiffDisplay}`;
    }

    // Handle each player's hiscores
    const allLive = playerData.map((pd, idx) => {
        if (!pd.live) {
            document.getElementById(players[idx].tableId).innerHTML =
                `<p class="error-message">Highscores not found for **${players[idx].rsn}**. Check spelling.</p>`;
            return null;
        }
        if (refreshBaselinesIfNeeded(pd.baselines, keys, pd.live)) {
            saveBaselines(players[idx].rsn, pd.baselines);
        }
        return pd.live;
    });

    if (allLive.every(Boolean)) {
        players.forEach((p, idx) => renderTable(p.tableId, compareAndPrepareDisplayData(allLive[idx], playerData[idx].baselines)));
    }
}

async function fetchGroupRank(groupName) {
    // NOTE: This scrapes the hiscores HTML page rather than a proper API.
    // If Jagex changes their page structure, this will silently return "Unranked".
    const targetUrl = `https://secure.runescape.com/m=hiscore_oldschool_ironman/group-ironman/?groupName=${encodeURIComponent(groupName)}&cb=${Date.now()}`;
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;

    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error("Failed to fetch group hiscores");
        
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const rows = doc.querySelectorAll("tr");
        
        for (const row of rows) {
            if (row.textContent.toLowerCase().includes(groupName.toLowerCase())) {
                const cells = row.querySelectorAll("td");
                if (cells.length > 0) {
                    return cells[0].textContent.trim();
                }
            }
        }
        return "Unranked";
    } catch (error) {
        console.error("Could not fetch group rank:", error);
        return "N/A";
    }
}

fetchAndDisplayScores();

// Load rank history and render the chart once on startup.
// The chart doesn't need to refresh every 60s — daily granularity is enough.
loadRankHistory().then(renderRankChart);

// Re-fetch live scores every 60 seconds so XP gains appear without a manual refresh.
// (Baselines in Firestore are unchanged — only the live hiscores poll is repeated.)
const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = setInterval(fetchAndDisplayScores, REFRESH_INTERVAL_MS);

// Also re-fetch immediately when the tab becomes visible again after being hidden,
// so a returning user always sees fresh data without waiting for the next tick.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        clearInterval(_refreshTimer);
        fetchAndDisplayScores();
        _refreshTimer = setInterval(fetchAndDisplayScores, REFRESH_INTERVAL_MS);
    }
});

// ── Task List (Firestore) ─────────────────────────────────────

// ── Assignee toggle state ────────────────────────────────────

const _assigneeState = { ely: false, lucian: false };
let _selectedSkill = null; // { name, wikiName } or null

function initAssigneeToggles() {
    ['ely', 'lucian'].forEach(player => {
        const btn = document.getElementById(`assignee-${player}`);
        btn.addEventListener('click', () => {
            _assigneeState[player] = !_assigneeState[player];
            btn.setAttribute('aria-pressed', _assigneeState[player]);
        });
    });
}

// ── Skill icon picker ────────────────────────────────────────

function initSkillPicker() {
    const btn     = document.getElementById('task-skill-btn');
    const popup   = document.getElementById('task-skill-popup');
    const grid    = document.getElementById('task-skill-grid');

    const PICKER_ICONS = [
        { name: 'Total',  wikiName: 'Overall',  url: getIconUrl('Overall') },
        { name: 'Quests', wikiName: 'Quests',   url: 'images/icon_quest.png' },
    ];

    // Build grid
    PICKER_ICONS.forEach(skill => {
        const optBtn = document.createElement('button');
        optBtn.className = 'task-skill-option';
        optBtn.title = skill.name;
        optBtn.type = 'button';

        const img = document.createElement('img');
        img.src = skill.url;
        img.alt = skill.name;
        optBtn.appendChild(img);

        optBtn.addEventListener('click', () => {
            if (_selectedSkill && _selectedSkill.name === skill.name) {
                _selectedSkill = null;
            } else {
                _selectedSkill = skill;
            }
            updateSkillBtn();
            grid.querySelectorAll('.task-skill-option').forEach(b => b.classList.remove('selected'));
            if (_selectedSkill) optBtn.classList.add('selected');
            popup.style.display = 'none';
        });

        grid.appendChild(optBtn);
    });

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'task-skill-clear';
    clearBtn.textContent = 'Clear selection';
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
        _selectedSkill = null;
        updateSkillBtn();
        grid.querySelectorAll('.task-skill-option').forEach(b => b.classList.remove('selected'));
        popup.style.display = 'none';
    });
    grid.appendChild(clearBtn);

    // Toggle popup
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !popup.contains(e.target)) {
            popup.style.display = 'none';
        }
    });
}

function updateSkillBtn() {
    const btn = document.getElementById('task-skill-btn');
    btn.innerHTML = '';
    if (_selectedSkill) {
        btn.classList.add('has-skill');
        const img = document.createElement('img');
        img.src = _selectedSkill.url || getIconUrl(_selectedSkill.wikiName);
        img.alt = _selectedSkill.name;
        btn.appendChild(img);
    } else {
        btn.classList.remove('has-skill');
        const span = document.createElement('span');
        span.textContent = '?';
        btn.appendChild(span);
    }
}

// ── Firestore actions ────────────────────────────────────────

async function addTask() {
    const input = document.getElementById('task-input');
    const text = input.value.trim();
    if (!text) return;

    const assignees = Object.keys(_assigneeState).filter(p => _assigneeState[p]);
    const skill = _selectedSkill ? { name: _selectedSkill.name, wikiName: _selectedSkill.wikiName, url: _selectedSkill.url } : null;

    input.value = '';
    input.focus();

    // Reset face toggles and skill after adding
    ['ely', 'lucian'].forEach(p => {
        _assigneeState[p] = false;
        document.getElementById(`assignee-${p}`).setAttribute('aria-pressed', 'false');
    });
    _selectedSkill = null;
    updateSkillBtn();

    try {
        await addDoc(_tasksCol, { text, completed: false, assignees, skill, createdAt: serverTimestamp() });
    } catch (e) {
        console.error("Could not add task:", e);
    }
}

async function toggleTask(id, currentState) {
    try {
        await updateDoc(doc(_db, "osrs_duo_tasks", id), { completed: !currentState });
    } catch (e) {
        console.error("Could not toggle task:", e);
    }
}

async function deleteTask(id) {
    try {
        await deleteDoc(doc(_db, "osrs_duo_tasks", id));
    } catch (e) {
        console.error("Could not delete task:", e);
    }
}

// ── Render ───────────────────────────────────────────────────

const PLAYER_IMAGES = {
    ely:    'images/head_ely.png',
    lucian: 'images/head_lucian.png'
};

function renderTasks(tasks) {
    const list  = document.getElementById('task-list');
    const empty = document.getElementById('task-empty');

    list.innerHTML = '';
    empty.style.display = tasks.length === 0 ? 'block' : 'none';

    tasks.forEach((task) => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.completed ? ' completed' : '');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', () => toggleTask(task.id, task.completed));

        const label = document.createElement('span');
        label.className = 'task-label';
        label.textContent = task.text;
        label.addEventListener('click', () => toggleTask(task.id, task.completed));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'task-delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.setAttribute('aria-label', 'Delete task');
        deleteBtn.addEventListener('click', () => deleteTask(task.id));

        li.appendChild(checkbox);

        // Skill icon (if set)
        if (task.skill) {
            const skillImg = document.createElement('img');
            skillImg.src = task.skill.url || getIconUrl(task.skill.wikiName);
            skillImg.alt = task.skill.name;
            skillImg.className = 'task-skill-icon';
            skillImg.title = task.skill.name;
            li.appendChild(skillImg);
        }

        li.appendChild(label);

        // Assignee avatars
        const assignees = task.assignees || [];
        if (assignees.length > 0) {
            const avatarWrapper = document.createElement('div');
            avatarWrapper.className = 'task-assignees';
            assignees.forEach(player => {
                if (PLAYER_IMAGES[player]) {
                    const img = document.createElement('img');
                    img.src = PLAYER_IMAGES[player];
                    img.alt = player;
                    img.className = 'task-assignee-avatar';
                    avatarWrapper.appendChild(img);
                }
            });
            li.appendChild(avatarWrapper);
        }

        li.appendChild(deleteBtn);
        list.appendChild(li);
    });
}

// ── Real-time listener ───────────────────────────────────────

const _tasksQuery = query(_tasksCol, orderBy("createdAt", "asc"));
onSnapshot(_tasksQuery, (snapshot) => {
    const tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks(tasks);
}, (e) => console.error("Task listener error:", e));

// ── Wire up events ───────────────────────────────────────────

initAssigneeToggles();
initSkillPicker();
document.getElementById('task-add-btn').addEventListener('click', addTask);
document.getElementById('task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});