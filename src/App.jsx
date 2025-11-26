import React, { useState, useEffect, useRef } from "react";
import html2canvas from "html2canvas";

/* ---------- Ortak Yardımcı Fonksiyonlar ---------- */

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const v = String(value)
    .replace(/\./g, "") // binlik ayırıcıları temizle
    .replace(",", "."); // ondalık işaretini normalize et
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function parseRate(value) {
  const n = parseNumber(value);
  if (n === 0) return 0;
  if (n > 1) return n / 100;
  if (n > 0.1) return n / 100;
  return n;
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return "0";
  return Math.round(num).toLocaleString("tr-TR");
}

function formatPercentFromRatio(ratio) {
  if (ratio === null || ratio === undefined || isNaN(ratio)) return "0";
  const percent = ratio * 100;
  return percent.toLocaleString("tr-TR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/* ---------- One Shot Campaign Hesabı ---------- */

function computeOneShotRow(row, params) {
  const baseAudience = parseNumber(row.baseAudience);

  const crPerWeekPercent = parseNumber(row.crPerWeek);
  const sharePercent = parseNumber(row.share);

  const crPerWeek = crPerWeekPercent / 100;
  const share = sharePercent / 100;

  const avgTrips = parseNumber(row.avgTrips);
  const reward = parseNumber(params.incPassengerFC);

  const passGrowthPercent = parseNumber(params.passGrowth);
  const tripGrowthPercent = parseNumber(params.tripGrowth);

  const passGrowthFactor = 1 + passGrowthPercent / 100;
  const tripGrowthFactor = 1 + tripGrowthPercent / 100;

  const campaignAudience = share * baseAudience;

  const budget =
    campaignAudience * (crPerWeek * passGrowthFactor) * reward;

  const incrementalPassengers =
    campaignAudience * (crPerWeek * passGrowthFactor) -
    campaignAudience * crPerWeek;

  const costPerIncPassenger =
    incrementalPassengers !== 0 ? budget / incrementalPassengers : 0;

  const totalTrips =
    campaignAudience *
    (crPerWeek * passGrowthFactor * (avgTrips * tripGrowthFactor));

  const incrementalTrips =
    incrementalPassengers * avgTrips * tripGrowthFactor +
    campaignAudience * crPerWeek * avgTrips * (tripGrowthFactor - 1);

  const costPerIncTrip =
    incrementalTrips !== 0 ? budget / incrementalTrips : 0;

  return {
    campaignAudience,
    budget,
    incrementalPassengers,
    costPerIncPassenger,
    totalTrips,
    incrementalTrips,
    costPerIncTrip,
  };
}

/* ---------- Milestone Campaign Hesabı ---------- */

function computeMilestoneRow(row, params) {
  const baseAudience = parseNumber(row.baseAudience);

  const rewardCountRaw = parseInt(params.rewardCount || "3", 10);
  const rewardCount = Math.max(
    1,
    Math.min(5, isNaN(rewardCountRaw) ? 3 : rewardCountRaw)
  );

  const crs = [];
  for (let i = 1; i <= rewardCount; i++) {
    crs.push(parseRate(row[`cr${i}`]));
  }

  const crGe = crs.reduce((sum, v) => sum + v, 0);

  const share = parseRate(row.sharePercent);
  const avgTrips2w = parseNumber(row.avgTrips2w);

  const rewardInputs = [];
  for (let i = 1; i <= rewardCount; i++) {
    rewardInputs.push(parseNumber(params[`reward${i}`]));
  }

  const cumulativeRewards = [];
  let cum = 0;
  for (let i = 0; i < rewardCount; i++) {
    cum += rewardInputs[i] || 0;
    cumulativeRewards.push(cum);
  }

  const passGrowthPercent = parseNumber(params.passGrowth);
  const tripGrowthPercent = parseNumber(params.tripGrowth);

  const passGrowthFactor = 1 + passGrowthPercent / 100;
  const tripGrowthFactor = 1 + tripGrowthPercent / 100;

  const campaignAudience = share * baseAudience;

  let spendSum = 0;
  for (let i = 0; i < rewardCount; i++) {
    const cri = crs[i] || 0;
    const rewardCum = cumulativeRewards[i] || 0;
    spendSum += cri * rewardCum;
  }
  const spend = campaignAudience * share * spendSum;

  const incrementalPassengers =
    campaignAudience * crGe * (passGrowthFactor - 1);

  const costIncPassenger =
    incrementalPassengers !== 0 ? spend / incrementalPassengers : 0;

  const tripFC =
    campaignAudience *
    (crGe * passGrowthFactor) *
    (avgTrips2w * tripGrowthFactor);

  const incTripFC =
    incrementalPassengers * avgTrips2w * tripGrowthFactor +
    campaignAudience *
      crGe *
      avgTrips2w *
      (tripGrowthFactor - 1);

  const costIncTrip = incTripFC !== 0 ? spend / incTripFC : 0;

  return {
    rewardCount,
    crGe,
    campaignAudience,
    spend,
    incrementalPassengers,
    costIncPassenger,
    tripFC,
    incTripFC,
    costIncTrip,
  };
}

/* ---------- OneShot Kartı ---------- */

function OneShotCard({ id, onDelete }) {
  const cardRef = useRef(null);
  const storageKey = `fizibilite-oneshot-${id}`;

  // ⬇️ İlk state'i localStorage'dan oku
  const initialSaved = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [title, setTitle] = useState(
    initialSaved?.title || "One Shot Campaign"
  );
  const [params, setParams] = useState(
    initialSaved?.params || {
      incPassengerFC: "",
      passGrowth: "",
      tripGrowth: "",
    }
  );
  const [rows, setRows] = useState(
    initialSaved?.rows || [
      {
        id: 1,
        segment: "",
        baseAudience: "",
        crPerWeek: "",
        share: "",
        avgTrips: "",
      },
    ]
  );

  // ⬇️ Değiştikçe kaydet
  useEffect(() => {
    try {
      const payload = { title, params, rows };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (e) {
      console.error("OneShot save error", e);
    }
  }, [storageKey, title, params, rows]);

  const handleParamChange = (field, value) => {
    setParams((prev) => ({ ...prev, [field]: value }));
  };

  const handleRowChange = (rowId, field, value) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: Date.now(),
        segment: "",
        baseAudience: "",
        crPerWeek: "",
        share: "",
        avgTrips: "",
      },
    ]);
  };

  const removeLastRow = () => {
    setRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const handleDeleteClick = () => {
    const ok = window.confirm("Bu kampanyayı silmek istediğine emin misin?");
    if (ok) {
      localStorage.removeItem(storageKey);
      if (typeof onDelete === "function") onDelete();
    }
  };

  const handleScreenshot = async () => {
    if (!cardRef.current) return;
    const canvas = await html2canvas(cardRef.current);
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = (title || "OneShot") + ".png";
    link.click();
  };

  const computedRows = rows.map((row) => ({
    ...row,
    ...computeOneShotRow(row, params),
  }));

  const totals = computedRows.reduce(
    (acc, row) => {
      acc.campaignAudience += row.campaignAudience || 0;
      acc.budget += row.budget || 0;
      acc.incrementalPassengers += row.incrementalPassengers || 0;
      acc.incrementalTrips += row.incrementalTrips || 0;
      return acc;
    },
    {
      campaignAudience: 0,
      budget: 0,
      incrementalPassengers: 0,
      incrementalTrips: 0,
    }
  );

  const totalCostPerIncPassenger =
    totals.incrementalPassengers !== 0
      ? totals.budget / totals.incrementalPassengers
      : 0;

  const totalCostPerIncTrip =
    totals.incrementalTrips !== 0
      ? totals.budget / totals.incrementalTrips
      : 0;

  const inputStyle = {
    width: "100%",
    padding: "3px 5px",
    borderRadius: "4px",
    border: "1px solid #d1d5db",
    fontSize: "12px",
    boxSizing: "border-box",
    height: "26px",
  };

  const smallInputStyle = {
    ...inputStyle,
    fontSize: "11px",
    height: "22px",
    padding: "2px 4px",
  };

  const td = {
    border: "1px solid #e5e7eb",
    padding: "2px 4px",
    verticalAlign: "middle",
  };

  const tdCenter = {
    ...td,
    textAlign: "center",
    whiteSpace: "nowrap",
  };

  const tdSegment = {
    ...td,
    minWidth: "160px",
  };

  const th = {
    border: "1px solid #d1d5db",
    padding: "6px 4px",
    background: "#f3f4f6",
    fontWeight: 600,
    textAlign: "center",
  };

  const thSegment = {
    ...th,
    minWidth: "160px",
  };

  return (
    <div
      ref={cardRef}
      style={{
        background: "white",
        padding: "24px",
        borderRadius: "16px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.07)",
        marginBottom: "24px",
      }}
    >
      {/* Başlık + screenshot + sil */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Çalışma başlığı (ör. One Shot Campaign)"
          style={{
            ...inputStyle,
            fontSize: "14px",
            fontWeight: 600,
            flexGrow: 1,
            marginBottom: 0,
          }}
        />
        <button
          onClick={handleScreenshot}
          title="Bu kartın ekran görüntüsünü indir"
          style={{
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            borderRadius: "999px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
          }}
        >
          📸
        </button>
        <button
          onClick={handleDeleteClick}
          title="Bu kampanyayı sil"
          style={{
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            borderRadius: "999px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Parametreler */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "12px",
          marginTop: "4px",
          border: "1px solid #e5e7eb",
          padding: "12px",
          borderRadius: "12px",
        }}
      >
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>Ödül</label>
          <input
            type="text"
            value={params.incPassengerFC}
            onChange={(e) =>
              handleParamChange("incPassengerFC", e.target.value)
            }
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>
            Passenger Büyüme (%)
          </label>
          <input
            type="text"
            value={params.passGrowth}
            onChange={(e) => handleParamChange("passGrowth", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>
            Trip Büyüme (%)
          </label>
          <input
            type="text"
            value={params.tripGrowth}
            onChange={(e) => handleParamChange("tripGrowth", e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Tablo */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "20px",
          fontSize: "12px",
        }}
      >
        <thead>
          <tr>
            <th style={thSegment}>Segment</th>
            <th style={th}>Ana Kitle</th>
            <th style={th}>CR / Week (%)</th>
            <th style={th}>Kitle Payı (%)</th>
            <th style={th}>Kampanya Kitle</th>
            <th style={th}>Budget</th>
            <th style={th}>Inc Passenger</th>
            <th style={th}>Cost / Inc Passenger</th>
            <th style={th}>Avg Trips / Week</th>
            <th style={th}>Toplam Trips</th>
            <th style={th}>Inc Trips</th>
            <th style={th}>Cost / Inc Trip</th>
          </tr>
        </thead>

        <tbody>
          {computedRows.map((row) => (
            <tr key={row.id}>
              <td style={tdSegment}>
                <input
                  type="text"
                  value={row.segment}
                  onChange={(e) =>
                    handleRowChange(row.id, "segment", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.baseAudience}
                  onChange={(e) =>
                    handleRowChange(row.id, "baseAudience", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.crPerWeek}
                  onChange={(e) =>
                    handleRowChange(row.id, "crPerWeek", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.share}
                  onChange={(e) =>
                    handleRowChange(row.id, "share", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={tdCenter}>{formatNumber(row.campaignAudience)}</td>
              <td style={tdCenter}>{formatNumber(row.budget)}</td>
              <td style={tdCenter}>
                {formatNumber(row.incrementalPassengers)}
              </td>
              <td style={tdCenter}>
                {formatNumber(row.costPerIncPassenger)}
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.avgTrips}
                  onChange={(e) =>
                    handleRowChange(row.id, "avgTrips", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={tdCenter}>{formatNumber(row.totalTrips)}</td>
              <td style={tdCenter}>{formatNumber(row.incrementalTrips)}</td>
              <td style={tdCenter}>{formatNumber(row.costPerIncTrip)}</td>
            </tr>
          ))}

          <tr style={{ background: "#f9fafb", fontWeight: 600 }}>
            <td style={td}>Toplam</td>
            <td style={td}></td>
            <td style={td}></td>
            <td style={td}></td>
            <td style={tdCenter}>{formatNumber(totals.campaignAudience)}</td>
            <td style={tdCenter}>{formatNumber(totals.budget)}</td>
            <td style={tdCenter}>
              {formatNumber(totals.incrementalPassengers)}
            </td>
            <td style={tdCenter}>
              {formatNumber(totalCostPerIncPassenger)}
            </td>
            <td style={td}></td>
            <td style={td}></td>
            <td style={td}></td>
            <td style={tdCenter}>{formatNumber(totalCostPerIncTrip)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
        <button
          onClick={addRow}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            padding: "8px 14px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          + Satır Ekle
        </button>

        <button
          onClick={removeLastRow}
          style={{
            background: "white",
            color: "#374151",
            border: "1px solid #9ca3af",
            padding: "8px 14px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Son Satırı Sil
        </button>
      </div>
    </div>
  );
}

/* ---------- Milestone Kartı ---------- */

function MilestoneCard({ id, onDelete }) {
  const cardRef = useRef(null);
  const storageKey = `fizibilite-milestone-${id}`;

  const initialSaved = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [title, setTitle] = useState(
    initialSaved?.title || "Milestone Campaign"
  );

  const [params, setParams] = useState(
    initialSaved?.params || {
      rewardCount: "3",
      reward1: "",
      reward2: "",
      reward3: "",
      reward4: "",
      reward5: "",
      passGrowth: "",
      tripGrowth: "",
    }
  );

  const [rows, setRows] = useState(
    initialSaved?.rows || [
      {
        id: 1,
        segment: "",
        baseAudience: "",
        cr1: "",
        cr2: "",
        cr3: "",
        cr4: "",
        cr5: "",
        sharePercent: "",
        avgTrips2w: "",
      },
    ]
  );

  useEffect(() => {
    try {
      const payload = { title, params, rows };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (e) {
      console.error("Milestone save error", e);
    }
  }, [storageKey, title, params, rows]);

  const handleParamChange = (field, value) => {
    setParams((prev) => ({ ...prev, [field]: value }));
  };

  const handleRowChange = (rowId, field, value) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: Date.now(),
        segment: "",
        baseAudience: "",
        cr1: "",
        cr2: "",
        cr3: "",
        cr4: "",
        cr5: "",
        sharePercent: "",
        avgTrips2w: "",
      },
    ]);
  };

  const removeLastRow = () => {
    setRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const handleDeleteClick = () => {
    const ok = window.confirm("Bu kampanyayı silmek istediğine emin misin?");
    if (ok) {
      localStorage.removeItem(storageKey);
      if (typeof onDelete === "function") onDelete();
    }
  };

  const handleScreenshot = async () => {
    if (!cardRef.current) return;
    const canvas = await html2canvas(cardRef.current);
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = (title || "Milestone") + ".png";
    link.click();
  };

  const computedRows = rows.map((row) => ({
    ...row,
    ...computeMilestoneRow(row, params),
  }));

  const rewardCountRaw = parseInt(params.rewardCount || "3", 10);
  const rewardCount = Math.max(
    1,
    Math.min(5, isNaN(rewardCountRaw) ? 3 : rewardCountRaw)
  );

  const totals = computedRows.reduce(
    (acc, row) => {
      acc.campaignAudience += row.campaignAudience || 0;
      acc.incrementalPassengers += row.incrementalPassengers || 0;
      acc.spend += row.spend || 0;
      acc.tripFC += row.tripFC || 0;
      acc.incTripFC += row.incTripFC || 0;
      return acc;
    },
    {
      campaignAudience: 0,
      incrementalPassengers: 0,
      spend: 0,
      tripFC: 0,
      incTripFC: 0,
    }
  );

  const totalCostIncPassenger =
    totals.incrementalPassengers !== 0
      ? totals.spend / totals.incrementalPassengers
      : 0;

  const totalCostIncTrip =
    totals.incTripFC !== 0 ? totals.spend / totals.incTripFC : 0;

  const inputStyle = {
    width: "100%",
    padding: "3px 5px",
    borderRadius: "4px",
    border: "1px solid #d1d5db",
    fontSize: "12px",
    boxSizing: "border-box",
    height: "26px",
  };

  const smallInputStyle = {
    ...inputStyle,
    fontSize: "11px",
    height: "22px",
    padding: "2px 4px",
  };

  const td = {
    border: "1px solid #e5e7eb",
    padding: "2px 4px",
    verticalAlign: "middle",
  };

  const tdCenter = {
    ...td,
    textAlign: "center",
    whiteSpace: "nowrap",
  };

  const tdSegment = {
    ...td,
    minWidth: "160px",
  };

  const th = {
    border: "1px solid #d1d5db",
    padding: "6px 4px",
    background: "#f3f4f6",
    fontWeight: 600,
    textAlign: "center",
  };

  const thSegment = {
    ...th,
    minWidth: "160px",
  };

  return (
    <div
      ref={cardRef}
      style={{
        background: "white",
        padding: "24px",
        borderRadius: "16px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.07)",
        marginBottom: "24px",
      }}
    >
      {/* Başlık + screenshot + sil */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Çalışma başlığı (ör. Milestone Campaign)"
          style={{
            ...inputStyle,
            fontSize: "14px",
            fontWeight: 600,
            flexGrow: 1,
            marginBottom: 0,
          }}
        />
        <button
          onClick={handleScreenshot}
          title="Bu kartın ekran görüntüsünü indir"
          style={{
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            borderRadius: "999px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
          }}
        >
          📸
        </button>
        <button
          onClick={handleDeleteClick}
          title="Bu kampanyayı sil"
          style={{
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            borderRadius: "999px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Parametreler */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "12px",
          marginTop: "4px",
          border: "1px solid #e5e7eb",
          padding: "12px",
          borderRadius: "12px",
        }}
      >
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>
            Ödül Sayısı (1–5)
          </label>
          <input
            type="number"
            min={1}
            max={5}
            value={params.rewardCount}
            onChange={(e) => handleParamChange("rewardCount", e.target.value)}
            style={inputStyle}
          />
        </div>

        {Array.from({ length: rewardCount }).map((_, idx) => {
          const index = idx + 1;
          return (
            <div key={index}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>
                {index}. Ödül
              </label>
              <input
                type="text"
                value={params[`reward${index}`] || ""}
                onChange={(e) =>
                  handleParamChange(`reward${index}`, e.target.value)
                }
                style={inputStyle}
              />
            </div>
          );
        })}

        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>
            Passenger Büyüme (%)
          </label>
          <input
            type="text"
            value={params.passGrowth}
            onChange={(e) => handleParamChange("passGrowth", e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>
            Trip Büyüme (%)
          </label>
          <input
            type="text"
            value={params.tripGrowth}
            onChange={(e) => handleParamChange("tripGrowth", e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Tablo */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "20px",
          fontSize: "12px",
        }}
      >
        <thead>
          <tr>
            <th style={thSegment}>Segment</th>
            <th style={th}>Ana Kitle</th>
            <th style={th}>CR ≥ 1</th>
            {Array.from({ length: rewardCount }).map((_, idx) => (
              <th key={idx} style={th}>
                CR {idx + 1}
              </th>
            ))}
            <th style={th}>% Kitle</th>
            <th style={th}>Kampanya Kitle</th>
            <th style={th}>Harcama</th>
            <th style={th}>Inc Passenger FC</th>
            <th style={th}>Cost / Inc Passenger</th>
            <th style={th}>Avg Trips / Week</th>
            <th style={th}>Trip FC</th>
            <th style={th}>Inc Trip FC</th>
            <th style={th}>Cost / Inc Trip</th>
          </tr>
        </thead>

        <tbody>
          {computedRows.map((row) => (
            <tr key={row.id}>
              <td style={tdSegment}>
                <input
                  type="text"
                  value={row.segment}
                  onChange={(e) =>
                    handleRowChange(row.id, "segment", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.baseAudience}
                  onChange={(e) =>
                    handleRowChange(row.id, "baseAudience", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={tdCenter}>{formatPercentFromRatio(row.crGe)}</td>

              {Array.from({ length: rewardCount }).map((_, idx) => {
                const field = `cr${idx + 1}`;
                return (
                  <td key={field} style={td}>
                    <input
                      type="text"
                      value={row[field] || ""}
                      onChange={(e) =>
                        handleRowChange(row.id, field, e.target.value)
                      }
                      style={smallInputStyle}
                    />
                  </td>
                );
              })}

              <td style={td}>
                <input
                  type="text"
                  value={row.sharePercent}
                  onChange={(e) =>
                    handleRowChange(row.id, "sharePercent", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={tdCenter}>{formatNumber(row.campaignAudience)}</td>
              <td style={tdCenter}>{formatNumber(row.spend)}</td>
              <td style={tdCenter}>
                {formatNumber(row.incrementalPassengers)}
              </td>
              <td style={tdCenter}>
                {formatNumber(row.costIncPassenger)}
              </td>

              <td style={td}>
                <input
                  type="text"
                  value={row.avgTrips2w}
                  onChange={(e) =>
                    handleRowChange(row.id, "avgTrips2w", e.target.value)
                  }
                  style={smallInputStyle}
                />
              </td>

              <td style={tdCenter}>{formatNumber(row.tripFC)}</td>
              <td style={tdCenter}>{formatNumber(row.incTripFC)}</td>
              <td style={tdCenter}>{formatNumber(row.costIncTrip)}</td>
            </tr>
          ))}

          <tr style={{ background: "#f9fafb", fontWeight: 600 }}>
            <td style={td}>Toplam</td>
            <td style={td}></td>
            <td style={td}></td>
            {Array.from({ length: rewardCount }).map((_, idx) => (
              <td key={idx} style={td}></td>
            ))}
            <td style={td}></td>
            <td style={tdCenter}>{formatNumber(totals.campaignAudience)}</td>
            <td style={tdCenter}>{formatNumber(totals.spend)}</td>
            <td style={tdCenter}>
              {formatNumber(totals.incrementalPassengers)}
            </td>
            <td style={tdCenter}>
              {formatNumber(totalCostIncPassenger)}
            </td>
            <td style={td}></td>
            <td style={tdCenter}>{formatNumber(totals.tripFC)}</td>
            <td style={tdCenter}>{formatNumber(totals.incTripFC)}</td>
            <td style={tdCenter}>{formatNumber(totalCostIncTrip)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
        <button
          onClick={addRow}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            padding: "8px 14px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          + Satır Ekle
        </button>

        <button
          onClick={removeLastRow}
          style={{
            background: "white",
            color: "#374151",
            border: "1px solid #9ca3af",
            padding: "8px 14px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Son Satırı Sil
        </button>
      </div>
    </div>
  );
}

/* ---------- Ana Uygulama ---------- */

export default function App() {
  const [cards, setCards] = useState(() => {
    if (typeof window === "undefined") return [{ id: 1, type: "oneshot" }];
    try {
      const saved = localStorage.getItem("fizibilite-cards");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{ id: 1, type: "oneshot" }];
  });

  useEffect(() => {
    try {
      localStorage.setItem("fizibilite-cards", JSON.stringify(cards));
    } catch (e) {
      console.error("Cards save error", e);
    }
  }, [cards]);

  const addCard = (type) => {
    const newCard = { id: Date.now(), type };
    setCards((prev) => [...prev, newCard]);
  };

  const deleteCard = (id) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    localStorage.removeItem(`fizibilite-oneshot-${id}`);
    localStorage.removeItem(`fizibilite-milestone-${id}`);
  };

  return (
    <div
      style={{
        padding: "24px",
        background: "#f3f4f6",
        minHeight: "100vh",
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto 16px auto",
        }}
      >
        <h1
          style={{
            fontSize: "26px",
            fontWeight: 800,
            margin: 0,
          }}
        >
          Fizibilite Master
        </h1>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <button
            onClick={() => addCard("oneshot")}
            style={{
              background: "#2563eb",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            + One Shot Campaign ekle
          </button>

          <button
            onClick={() => addCard("milestone")}
            style={{
              background: "#10b981",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            + Milestone Campaign ekle
          </button>
        </div>

        {cards.map((card) =>
          card.type === "oneshot" ? (
            <OneShotCard
              key={card.id}
              id={card.id}
              onDelete={() => deleteCard(card.id)}
            />
          ) : (
            <MilestoneCard
              key={card.id}
              id={card.id}
              onDelete={() => deleteCard(card.id)}
            />
          )
        )}
      </div>
    </div>
  );
}
