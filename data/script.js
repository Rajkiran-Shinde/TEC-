// ================= GLOBAL VARIABLES =================
let tempVoltageChart, socChart;
// Keep track of data history for graphs (max points)
const maxDataPoints = 30; 
let dataHistory = {
    labels: [],
    temp: [],
    voltage: [],
    soc: []
};

// --- System Logging & Time Variables ---
let logs = JSON.parse(localStorage.getItem('ev_bms_logs')) || [];
let lastState = {
    charging: null,
    status: null
};

// ================= NAVIGATION =================
// Function to switch between different sections (Home, Stats, Graphs, About)
function navigateTo(sectionId) {
    // Get all sections
    const sections = document.querySelectorAll('section');
    
    // Hide all active sections first
    sections.forEach(sec => {
        sec.classList.remove('active-section');
        // Add hidden class after transition to ensure it doesn't block clicks
        setTimeout(() => {
             if (sec.id !== sectionId) sec.classList.add('hidden-section');
        }, 500); // Match CSS transition time
    });

    // Show the selected section
    const targetSection = document.getElementById(sectionId);
    targetSection.classList.remove('hidden-section');
    // Small delay to allow CSS to register the removal of 'hidden-section' before adding active
    setTimeout(() => {
        targetSection.classList.add('active-section');
    }, 50);

    // If navigating to graphs, resize charts to fit container
    if (sectionId === 'graphs-section' && tempVoltageChart && socChart) {
        tempVoltageChart.resize();
        socChart.resize();
    }
}


// ================= DATA FETCHING & UPDATING =================

// Main function calling the data update loop
function startDataMonitoring() {
    // Poll data every 2 seconds (2000ms)
    setInterval(fetchDataFromESP, 2000);
}

async function fetchDataFromESP() {
    /* ----- ESP32 INTEGRATION INSTRUCTIONS -----
       When you integrate this with your ESP32 code, you need to:
       1. Uncomment the 'real' fetch block below.
       2. Delete or comment out the 'SIMULATION BLOCK'.
       3. Ensure your ESP32 webserver has a handler for "/api/data" that returns 
          JSON like: {"voltage": 3.8, "soc": 85.5, "temp": 28.0, "soh": 98.0, "status": "NORMAL"}
    */

   
    try {
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        updateDashboard(data);
        updateCharts(data);
    } catch (error) {
        console.error('Error fetching data from ESP32:', error);
        document.getElementById('status-val').innerText = "CONN ERR";
    }

}

// Helper to update HTML elements with new data
// ================= LOGGING, UPTIME & CLOCK FUNCTIONS =================

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    
    return "Uptime: " + parts.join(" ");
}

function updateClock() {
    const clockEl = document.getElementById('clock-display');
    if (clockEl) {
        const now = new Date();
        clockEl.innerText = "Local Time: " + now.toLocaleTimeString();
    }
}

function addLog(message) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString() + " " + now.toLocaleDateString();
    const logEntry = {
        time: timeStr,
        msg: message
    };
    
    logs.unshift(logEntry); // Newest log at start
    if (logs.length > 5) {
        logs = logs.slice(0, 5); // Keep last 5 logs
    }
    
    localStorage.setItem('ev_bms_logs', JSON.stringify(logs));
    renderLogs();
}

function renderLogs() {
    const listEl = document.getElementById('logs-list');
    if (!listEl) return;
    
    if (logs.length === 0) {
        listEl.innerHTML = `<li class="no-logs">No system logs available.</li>`;
        return;
    }
    
    listEl.innerHTML = logs.map(log => `
        <li>
            <span class="log-time">[${log.time}]</span>
            <span class="log-message">${log.msg}</span>
        </li>
    `).join('');
}

function updateDashboard(data) {
    document.getElementById('voltage-val').innerText = data.voltage.toFixed(2);
    document.getElementById('soc-val').innerText = data.soc.toFixed(1);
    document.getElementById('temp-val').innerText = data.temp.toFixed(1);
    
    // Calculate SOH if your ESP doesn't send it directly, or use the value sent
    // Based on your Arduino code: float soh = (voltage / 4.20) * 100.0;
    let soh = (data.voltage / 4.20) * 100.0;
    if(soh > 100) soh = 100;
    document.getElementById('soh-val').innerText = soh.toFixed(1);

    const statusEl = document.getElementById('status-val');
    statusEl.innerText = data.status;
    
    // Change status color based on alert state
    if (data.status !== "NORMAL") {
        statusEl.style.color = "#ff3838"; // Red for alert
    } else {
        statusEl.style.color = "#ff6b81"; // Default pink
    }

    const chargingEl = document.getElementById('charging-val');
    if (chargingEl) {
        if (data.charging) {
            chargingEl.innerText = "CHARGING";
            chargingEl.style.color = "#2ecc71"; // Green for charging
        } else {
            chargingEl.innerText = "DISCHG";
            chargingEl.style.color = ""; // Default text color
        }
    }

    // Update Uptime
    if (data.uptime !== undefined) {
        document.getElementById('uptime-display').innerText = formatUptime(data.uptime);
    }

    // Check and Log State Changes
    if (lastState.charging === null) {
        // Initial load
        lastState.charging = data.charging;
        lastState.status = data.status;
        
        if (logs.length === 0) {
            addLog(`System initialized. Status: ${data.status} | Battery: ${data.charging ? "CHARGING" : "DISCHG"}`);
        }
    } else {
        // Check charging state change
        if (lastState.charging !== data.charging) {
            const stateMsg = data.charging ? "Battery state: CHARGING" : "Battery state: NOT CHARGING (Discharging)";
            addLog(stateMsg);
        }
        // Check system status change
        if (lastState.status !== data.status) {
            addLog(`System status: ${data.status}`);
        }
        
        lastState.charging = data.charging;
        lastState.status = data.status;
    }
}

// Helper function for simulation mode only
let simVolts = 3.7; let simTemp = 25;
function simulateESPData() {
    // Slightly wiggle the values randomly
    simVolts += (Math.random() - 0.5) * 0.1;
    if(simVolts > 4.2) simVolts = 4.2; if(simVolts < 3.0) simVolts = 3.0;
    
    simTemp += (Math.random() - 0.5) * 0.5;
    
    let simSoc = ((simVolts - 3.0) / (4.2 - 3.0)) * 100;
    let statusStr = "NORMAL";
    if(simSoc < 20) statusStr = "LOW BATTERY";
    if(simTemp > 45) statusStr = "OVER TEMP";

    return {
        voltage: simVolts,
        soc: simSoc,
        temp: simTemp,
        status: statusStr
    };
}


// ================= CHARTS CONFIGURATION =================

function initCharts() {
    Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
    Chart.defaults.borderColor = 'rgba(255, 107, 129, 0.2)';

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { ticks: { display: false } /* Hide X-axis labels for cleaner look */ },
            y: { beginAtZero: false }
        },
        plugins: {
            legend: { position: 'top' }
        },
        animation: { duration: 0 } // Disable chart animation for smoother real-time updates
    };

    // --- Chart 1: Temperature & Voltage Combined ---
    const ctxTV = document.getElementById('tempVoltageChart').getContext('2d');
    tempVoltageChart = new Chart(ctxTV, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: [],
                    borderColor: '#ff6b81', // Pink
                    backgroundColor: 'rgba(255, 107, 129, 0.1)',
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Voltage (V)',
                    data: [],
                    borderColor: '#a29bfe', // Purple
                    borderDash: [5, 5], // Dashed line for voltage
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                x: { ticks: { display: false } },
                y: { 
                    type: 'linear', display: true, position: 'left',
                    title: { display: true, text: 'Temp (°C)' }
                },
                y1: {
                    type: 'linear', display: true, position: 'right',
                    title: { display: true, text: 'Voltage (V)' },
                    grid: { drawOnChartArea: false } // Only draw grid for the main Y axis
                }
            }
        }
    });

    // --- Chart 2: SOC % ---
    const ctxSOC = document.getElementById('socChart').getContext('2d');
    socChart = new Chart(ctxSOC, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'SOC (%)',
                data: [],
                borderColor: '#00d2d3', // Cyan/Greenish
                backgroundColor: 'rgba(0, 210, 211, 0.1)',
                fill: true,
                tension: 0.4 // Smooth curves
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                 y: { min: 0, max: 100, title: { display: true, text: 'Percentage' } }
            }
        }
    });
}

function updateCharts(data) {
    // Create a timestamp label
    const now = new Date();
    const timeLabel = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();

    // Add new data to history arrays
    dataHistory.labels.push(timeLabel);
    dataHistory.temp.push(data.temp);
    dataHistory.voltage.push(data.voltage);
    dataHistory.soc.push(data.soc);

    // Remove oldest data point if exceeding max allowed history
    if (dataHistory.labels.length > maxDataPoints) {
        dataHistory.labels.shift();
        dataHistory.temp.shift();
        dataHistory.voltage.shift();
        dataHistory.soc.shift();
    }

    // Update Chart 1 (Temp & Voltage)
    tempVoltageChart.data.labels = dataHistory.labels;
    tempVoltageChart.data.datasets[0].data = dataHistory.temp;
    tempVoltageChart.data.datasets[1].data = dataHistory.voltage;
    tempVoltageChart.update();

    // Update Chart 2 (SOC)
    socChart.data.labels = dataHistory.labels;
    socChart.data.datasets[0].data = dataHistory.soc;
    socChart.update();
}


// ================= INITIALIZATION =================
// Run when page loads
window.onload = function() {
    // 1. Initialize charts empty
    initCharts();
    // 2. Start fetching data loop
    startDataMonitoring();
    // 3. Ensure we start on home section
    navigateTo('home-section');
    // 4. Initialize Local Clock
    setInterval(updateClock, 1000);
    updateClock();
    // 5. Render logs from localStorage
    renderLogs();
    console.log("Web Interface Loaded.");
};