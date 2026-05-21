import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const dataRef = ref(database, "idnumber");
const ONLINE_GRACE_SECONDS = 90;
const STALE_RECORD_SECONDS = 24 * 60 * 60;

let tableData = [];
let currentRegion = "tatca";
let currentIPFilter = "";
let currentProfileFilter = "";

function pickFirstValue(entry, keys, fallback = "N/A") {
  for (const key of keys) {
    const value = entry?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return fallback;
}

function getUserNameFromPath(path) {
  return String(path || "N/A").split("\\").pop();
}

function parseFlexibleDate(dateStr) {
  try {
    const cleanStr = String(dateStr)
      .trim()
      .replace(" SA", " AM")
      .replace(" CH", " PM");

    if (cleanStr.includes("-")) {
      const [datePart, timePart, meridian] = cleanStr.split(" ");
      const [day, monthText, yearShort] = datePart.split("-");
      const year = "20" + yearShort;
      return new Date(`${monthText} ${day}, ${year} ${timePart} ${meridian || ""}`);
    }

    const [datePart, timePart, meridian] = cleanStr.split(" ");
    const [d1, d2, d3] = datePart.split("/");
    let day;
    let month;
    let year;

    if (parseInt(d1, 10) > 12) {
      day = d1;
      month = d2;
      year = d3;
    } else {
      month = d1;
      day = d2;
      year = d3;
    }

    return new Date(`${month}/${day}/${year} ${timePart} ${meridian || ""}`);
  } catch {
    return new Date(String(dateStr).replace(" ", "T"));
  }
}

function getEntrySortTime(entry) {
  if (!entry?.time) return 0;

  const date = parseFlexibleDate(entry.time);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getAgeSeconds(sortTime, now = Date.now()) {
  if (!sortTime) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - sortTime) / 1000);
}

function isVisibleRecord(entry, now = Date.now()) {
  return getAgeSeconds(entry.sortTime, now) <= STALE_RECORD_SECONDS;
}

function getMachineStatus(entry, now = Date.now()) {
  return getAgeSeconds(entry.sortTime, now) <= ONLINE_GRACE_SECONDS ? "Online" : "Offline";
}

onValue(dataRef, (snapshot) => {
  const data = snapshot.val();
  tableData = [];

  if (data) {
    for (const key in data) {
      const entry = data[key];

      tableData.push({
        hostName: pickFirstValue(entry, ["hostName", "computername", "computerName"], key),
        IPAddress: pickFirstValue(entry, ["IPAddress", "IPaddress", "ipAddress", "ip"]),
        loggedUser: pickFirstValue(entry, ["loggedUser", "userName", "username"], ""),
        time: entry.time || "N/A",
        userProfile: pickFirstValue(entry, ["userProfile"], ""),
        sortTime: getEntrySortTime(entry),
      });
    }

    tableData.sort((a, b) => b.sortTime - a.sortTime);
  }

  applyFilterAndDisplayTable();
});

function displayTable(data) {
  const tbody = document.querySelector("#data-table tbody");
  if (!tbody) return;

  const prevScroll = tbody.scrollTop;
  tbody.innerHTML = "";

  if (data.length > 0) {
    data.forEach((entry, index) => {
      const row = document.createElement("tr");
      const status = getMachineStatus(entry);
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${entry.hostName}</td>
        <td>
          <span>${entry.IPAddress}</span>
          <button class="btn btn-info btn-sm copy-btn ms-2" onclick="copyToClipboard('${entry.IPAddress}')">Copy</button>
        </td>
        <td>${entry.time}</td>
        <td><span class="status-badge status-${status.toLowerCase()}">${status}</span></td>
        <td>${entry.loggedUser || getUserNameFromPath(entry.userProfile)}</td>
        <td>${getUserNameFromPath(entry.userProfile)}</td>
      `;
      tbody.appendChild(row);
    });
  } else {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-light">No machines found</td></tr>`;
  }

  setTimeout(() => (tbody.scrollTop = prevScroll), 0);
}

window.copyToClipboard = function (value) {
  navigator.clipboard.writeText(value);
};

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

function applyFilterAndDisplayTable() {
  const ipText = currentIPFilter.toLowerCase().trim();
  const profileText = currentProfileFilter.toLowerCase().trim();
  const now = Date.now();

  const filtered = tableData.filter((d) => {
    if (!isVisibleRecord(d, now)) return false;

    const ip = (d.IPAddress || "").toLowerCase();
    const profile = getUserNameFromPath(d.userProfile).toLowerCase();
    const loggedUser = (d.loggedUser || "").toLowerCase();

    const matchIP = !ipText || ip.includes(ipText);
    const matchProfile = !profileText || profile.includes(profileText) || loggedUser.includes(profileText);

    let matchRegion = true;
    switch (currentRegion) {
      case "cantho":
        matchRegion = ip.startsWith("172.16.10.");
        break;
      case "daklak":
        matchRegion = ip.startsWith("172.16.80.");
        break;
      case "quangngai":
        matchRegion = ip.startsWith("192.168.1.");
        break;
      case "binhthanh":
        matchRegion = ip.startsWith("10.10.");
        break;
      case "khac":
        matchRegion = !(
          ip.startsWith("172.16.10.") ||
          ip.startsWith("172.16.80.") ||
          ip.startsWith("192.168.1.") ||
          ip.startsWith("10.10.")
        );
        break;
      default:
        matchRegion = true;
    }

    return matchIP && matchProfile && matchRegion;
  });

  displayTable(filtered);
}

window.locTheoKhuVuc = function (khuVuc) {
  currentRegion = khuVuc || "tatca";

  const btn = document.querySelector("#dropdownMenuButton");
  if (btn) {
    const labelMap = {
      tatca: "Tất cả",
      cantho: "Cần Thơ",
      daklak: "Đắk Lắk",
      quangngai: "Quảng Ngãi",
      binhthanh: "Bình Thạnh",
      khac: "Khác",
    };
    btn.textContent = labelMap[khuVuc] || "Chọn khu vực";
  }

  applyFilterAndDisplayTable();
};

setInterval(applyFilterAndDisplayTable, 30 * 1000);

const ipInput = document.getElementById("filter-ip");
const profileInput = document.getElementById("filter-profile");

if (ipInput) {
  ipInput.addEventListener(
    "input",
    debounce((e) => {
      currentIPFilter = e.target.value;
      applyFilterAndDisplayTable();
    }, 250)
  );
}

if (profileInput) {
  profileInput.addEventListener(
    "input",
    debounce((e) => {
      currentProfileFilter = e.target.value;
      applyFilterAndDisplayTable();
    }, 250)
  );
}
