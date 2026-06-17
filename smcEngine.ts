export interface SMCCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SMCOrderBlock {
  id: string;
  type: "BULLISH" | "BEARISH";
  startIdx: number;
  endIdx: number;
  high: number;
  low: number;
  mitigated: boolean;
  mitigatedAtIdx?: number;
}

export interface SMCFairValueGap {
  id: string;
  type: "BULLISH" | "BEARISH";
  startIdx: number;
  endIdx: number;
  top: number;
  bottom: number;
  mitigated: boolean;
  mitigatedAtIdx?: number;
}

export interface SMCLiquiditySweep {
  id: string;
  type: "BSL" | "SSL"; // Buy-Side Liquidity (high swept), Sell-Side Liquidity (low swept)
  idx: number;
  price: number;
  sweptPrice: number;
  description: string;
}

export interface SMCEqualHighLow {
  id: string;
  type: "EQH" | "EQL";
  idx1: number;
  idx2: number;
  price1: number;
  price2: number;
  averagePrice: number;
}

export interface SMCStructureLine {
  id: string;
  type: "BOS" | "CHOCH";
  direction: "BULLISH" | "BEARISH";
  startIdx: number;
  endIdx: number;
  price: number;
  label: string;
}

export interface SMCMitigationBlock {
  id: string;
  type: "BULLISH" | "BEARISH"; // Bullish MB (broken Bearish OB), Bearish MB (broken Bullish OB)
  startIdx: number;
  endIdx: number;
  high: number;
  low: number;
}

export interface SMCAnalysisReport {
  orderBlocks: SMCOrderBlock[];
  fvgs: SMCFairValueGap[];
  sweeps: SMCLiquiditySweep[];
  eqhEqls: SMCEqualHighLow[];
  structures: SMCStructureLine[];
  mitigationBlocks: SMCMitigationBlock[];
}

/**
 * Algorithmic Smart Money Concepts (SMC) Engine
 */
export function detectSMC(candles: SMCCandle[]): SMCAnalysisReport {
  const orderBlocks: SMCOrderBlock[] = [];
  const fvgs: SMCFairValueGap[] = [];
  const sweeps: SMCLiquiditySweep[] = [];
  const eqhEqls: SMCEqualHighLow[] = [];
  const structures: SMCStructureLine[] = [];
  const mitigationBlocks: SMCMitigationBlock[] = [];

  if (candles.length < 15) {
    return { orderBlocks, fvgs, sweeps, eqhEqls, structures, mitigationBlocks };
  }

  // 1. Detect Swing Highs and Lows (Fractals / Pivots)
  const swingHighs: { idx: number; val: number; timestamp: number }[] = [];
  const swingLows: { idx: number; val: number; timestamp: number }[] = [];
  const p = 3; // Left/right candle check window

  for (let i = p; i < candles.length - p; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= p; j++) {
      if (candles[i - j].high > candles[i].high || candles[i + j].high >= candles[i].high) {
        isHigh = false;
      }
      if (candles[i - j].low < candles[i].low || candles[i + j].low <= candles[i].low) {
        isLow = false;
      }
    }

    if (isHigh) {
      swingHighs.push({ idx: i, val: candles[i].high, timestamp: candles[i].timestamp });
    }
    if (isLow) {
      swingLows.push({ idx: i, val: candles[i].low, timestamp: candles[i].timestamp });
    }
  }

  // Helper arrays of all swing levels up to current index
  const getActiveSwingsUpto = (currentIdx: number) => {
    return {
      highs: swingHighs.filter((s) => s.idx < currentIdx),
      lows: swingLows.filter((s) => s.idx < currentIdx),
    };
  };

  // 2. Detect Fair Value Gaps (FVG) and Order Blocks (OB)
  for (let i = 2; i < candles.length; i++) {
    // Bullish FVG (large green candle leaves gap)
    if (candles[i - 2].high < candles[i].low && candles[i - 1].close > candles[i - 1].open) {
      const bottom = candles[i - 2].high;
      const top = candles[i].low;
      
      // Determine mitigation
      let mitigated = false;
      let mitigatedAtIdx: number | undefined = undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low <= bottom) {
          mitigated = true;
          mitigatedAtIdx = j;
          break;
        }
      }

      fvgs.push({
        id: `fvg-bull-${i}`,
        type: "BULLISH",
        startIdx: i - 1,
        endIdx: mitigatedAtIdx !== undefined ? mitigatedAtIdx : candles.length - 1,
        top,
        bottom,
        mitigated,
        mitigatedAtIdx,
      });

      // Bullsih Order Block (OB): Look backward for the last bearish candle before the expansion
      let obIdx = -1;
      for (let k = i - 2; k >= Math.max(0, i - 10); k--) {
        if (candles[k].close < candles[k].open) {
          obIdx = k;
          break;
        }
      }

      if (obIdx !== -1) {
        const obCandle = candles[obIdx];
        let obMitigated = false;
        let obMitAt: number | undefined = undefined;
        let obIsBroken = false;
        let obBrokenAt: number | undefined = undefined;

        // Trace forward to check mitigation or break
        for (let j = obIdx + 1; j < candles.length; j++) {
          // Mitigation: Price touches the top of Bullish OB
          if (!obMitigated && candles[j].low <= obCandle.high) {
            obMitigated = true;
            obMitAt = j;
          }
          // Broken: Price closes below the bottom of Bullish OB
          if (candles[j].close < obCandle.low) {
            obIsBroken = true;
            obBrokenAt = j;
            break;
          }
        }

        if (obIsBroken && obBrokenAt !== undefined) {
          // Becomes a Bearish Mitigation Block (MB)
          mitigationBlocks.push({
            id: `mb-bear-${obIdx}-${i}`,
            type: "BEARISH",
            startIdx: obIdx,
            endIdx: candles.length - 1,
            high: obCandle.high,
            low: obCandle.low,
          });
        } else {
          orderBlocks.push({
            id: `ob-bull-${obIdx}-${i}`,
            type: "BULLISH",
            startIdx: obIdx,
            endIdx: obMitAt !== undefined ? obMitAt : candles.length - 1,
            high: obCandle.high,
            low: obCandle.low,
            mitigated: obMitigated,
            mitigatedAtIdx: obMitAt,
          });
        }
      }
    }

    // Bearish FVG (large red candle leaves gap)
    if (candles[i - 2].low > candles[i].high && candles[i - 1].close < candles[i - 1].open) {
      const top = candles[i - 2].low;
      const bottom = candles[i].high;

      let mitigated = false;
      let mitigatedAtIdx: number | undefined = undefined;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high >= top) {
          mitigated = true;
          mitigatedAtIdx = j;
          break;
        }
      }

      fvgs.push({
        id: `fvg-bear-${i}`,
        type: "BEARISH",
        startIdx: i - 1,
        endIdx: mitigatedAtIdx !== undefined ? mitigatedAtIdx : candles.length - 1,
        top,
        bottom,
        mitigated,
        mitigatedAtIdx,
      });

      // Bearish Order Block (OB): Look backward for the last bullish candle before the collapse
      let obIdx = -1;
      for (let k = i - 2; k >= Math.max(0, i - 10); k--) {
        if (candles[k].close > candles[k].open) {
          obIdx = k;
          break;
        }
      }

      if (obIdx !== -1) {
        const obCandle = candles[obIdx];
        let obMitigated = false;
        let obMitAt: number | undefined = undefined;
        let obIsBroken = false;
        let obBrokenAt: number | undefined = undefined;

        // Trace forward for mitigation or break
        for (let j = obIdx + 1; j < candles.length; j++) {
          if (!obMitigated && candles[j].high >= obCandle.low) {
            obMitigated = true;
            obMitAt = j;
          }
          if (candles[j].close > obCandle.high) {
            obIsBroken = true;
            obBrokenAt = j;
            break;
          }
        }

        if (obIsBroken && obBrokenAt !== undefined) {
          // Becomes a Bullish Mitigation Block (MB) - Support zone
          mitigationBlocks.push({
            id: `mb-bull-${obIdx}-${i}`,
            type: "BULLISH",
            startIdx: obIdx,
            endIdx: candles.length - 1,
            high: obCandle.high,
            low: obCandle.low,
          });
        } else {
          orderBlocks.push({
            id: `ob-bear-${obIdx}-${i}`,
            type: "BEARISH",
            startIdx: obIdx,
            endIdx: obMitAt !== undefined ? obMitAt : candles.length - 1,
            high: obCandle.high,
            low: obCandle.low,
            mitigated: obMitigated,
            mitigatedAtIdx: obMitAt,
          });
        }
      }
    }
  }

  // 3. Detect Structure (BOS & CHOCH) and Sweeps
  // Maintain intermediate market trend tracker ('BULLISH' or 'BEARISH')
  let marketTrend: "BULLISH" | "BEARISH" = "BULLISH";
  
  // Set initial trend based on a comparison of moving averages or simple swing structure
  if (candles[candles.length - 1].close < candles[0].close) {
    marketTrend = "BEARISH";
  }

  let lastHighTarget: { idx: number; val: number } | null = null;
  let lastLowTarget: { idx: number; val: number } | null = null;

  for (let i = 10; i < candles.length; i++) {
    const active = getActiveSwingsUpto(i);
    
    const recentHighs = active.highs.filter((h) => h.idx < i && h.idx >= i - 60);
    const recentLows = active.lows.filter((l) => l.idx < i && l.idx >= i - 60);

    const highestRecent = recentHighs.reduce((max, h) => (h.val > max.val ? h : max), { idx: 0, val: 0 });
    const lowestRecent = recentLows.reduce((min, l) => (l.val < min.val ? l : min), { idx: 0, val: Infinity });

    if (highestRecent.idx > 0) {
      lastHighTarget = highestRecent;
    }
    if (lowestRecent.idx > 0 && lowestRecent.val !== Infinity) {
      lastLowTarget = lowestRecent;
    }

    // A. Trend Breakouts: BOS and CHOCH
    // Bullish breaks
    if (lastHighTarget && lastHighTarget.idx < i) {
      const targetVal = lastHighTarget.val;
      const curClose = candles[i].close;
      const curHigh = candles[i].high;

      // Close above confirms BOS/CHOCH
      if (curClose > targetVal) {
        if (marketTrend === "BEARISH") {
          // Reversal breakdown! Bearish to Bullish transition
          structures.push({
            id: `choch-bull-${i}`,
            type: "CHOCH",
            direction: "BULLISH",
            startIdx: lastHighTarget.idx,
            endIdx: i,
            price: targetVal,
            label: "Bullish CHOCH",
          });
          marketTrend = "BULLISH";
        } else {
          // Continuation structure breakout
          structures.push({
            id: `bos-bull-${i}`,
            type: "BOS",
            direction: "BULLISH",
            startIdx: lastHighTarget.idx,
            endIdx: i,
            price: targetVal,
            label: "Bullish BOS",
          });
        }
        // High is cleared, reset target
        lastHighTarget = null;
      }
      // B. Liquidity Sweeps (High swept and rejected)
      else if (curHigh > targetVal && curClose <= targetVal) {
        sweeps.push({
          id: `sweep-bsl-${i}`,
          type: "BSL",
          idx: i,
          price: targetVal,
          sweptPrice: curHigh,
          description: `Buy-Side Liquidity (BSL) swept above swing high ${targetVal.toFixed(4)}. Market rejected to close at ${curClose.toFixed(4)}.`,
        });
        lastHighTarget = null; // High point was swept
      }
    }

    // Bearish breaks
    if (lastLowTarget && lastLowTarget.idx < i) {
      const targetVal = lastLowTarget.val;
      const curClose = candles[i].close;
      const curLow = candles[i].low;

      if (curClose < targetVal) {
        if (marketTrend === "BULLISH") {
          // Reversal collapse! Bullish to Bearish transition
          structures.push({
            id: `choch-bear-${i}`,
            type: "CHOCH",
            direction: "BEARISH",
            startIdx: lastLowTarget.idx,
            endIdx: i,
            price: targetVal,
            label: "Bearish CHOCH",
          });
          marketTrend = "BEARISH";
        } else {
          // Continuation breakdown
          structures.push({
            id: `bos-bear-${i}`,
            type: "BOS",
            direction: "BEARISH",
            startIdx: lastLowTarget.idx,
            endIdx: i,
            price: targetVal,
            label: "Bearish BOS",
          });
        }
        lastLowTarget = null;
      }
      // Liquidity Sweeps (Low swept and rejected)
      else if (curLow < targetVal && curClose >= targetVal) {
        sweeps.push({
          id: `sweep-ssl-${i}`,
          type: "SSL",
          idx: i,
          price: targetVal,
          sweptPrice: curLow,
          description: `Sell-Side Liquidity (SSL) swept below swing low ${targetVal.toFixed(4)}. Price bounced to close at ${curClose.toFixed(4)}.`,
        });
        lastLowTarget = null; // Low point was swept
      }
    }
  }

  // 4. Equal Highs (EQH) and Equal Lows (EQL) Detection
  // Check pairs of recent swings that are within a very small threshold
  const atrThresholdRatio = 0.0007; // Tolerance of price (0.07%)
  
  for (let i = 0; i < swingHighs.length; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      const h1 = swingHighs[i];
      const h2 = swingHighs[j];
      // Minimize check distance
      if (h2.idx - h1.idx > 60) continue;

      const avg = (h1.val + h2.val) / 2;
      const pctDiff = Math.abs(h1.val - h2.val) / avg;
      
      if (pctDiff < atrThresholdRatio) {
        // Confirm no intervening peak is much higher
        let valid = true;
        for (let k = h1.idx + 1; k < h2.idx; k++) {
          if (candles[k].high > Math.max(h1.val, h2.val) * 1.002) {
            valid = false;
            break;
          }
        }

        if (valid) {
          eqhEqls.push({
            id: `eqh-${h1.idx}-${h2.idx}`,
            type: "EQH",
            idx1: h1.idx,
            idx2: h2.idx,
            price1: h1.val,
            price2: h2.val,
            averagePrice: avg,
          });
          break; // Avoid spamming multiple connections
        }
      }
    }
  }

  for (let i = 0; i < swingLows.length; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      const l1 = swingLows[i];
      const l2 = swingLows[j];
      if (l2.idx - l1.idx > 60) continue;

      const avg = (l1.val + l2.val) / 2;
      const pctDiff = Math.abs(l1.val - l2.val) / avg;

      if (pctDiff < atrThresholdRatio) {
        let valid = true;
        for (let k = l1.idx + 1; k < l2.idx; k++) {
          if (candles[k].low < Math.min(l1.val, l2.val) * 0.998) {
            valid = false;
            break;
          }
        }

        if (valid) {
          eqhEqls.push({
            id: `eql-${l1.idx}-${l2.idx}`,
            type: "EQL",
            idx1: l1.idx,
            idx2: l2.idx,
            price1: l1.val,
            price2: l2.val,
            averagePrice: avg,
          });
          break;
        }
      }
    }
  }

  // Deduplicate structure lines to keep chart extremely readable
  const finalStructures = structures.slice(-80); // Last 12 structure structures are ample for visual charts
  const finalOrderBlocks = orderBlocks.slice(-60); // Last 8 order blocks
  const finalFvgs = fvgs.slice(-80); // Last 10 FVGs
  const finalMitBlock = mitigationBlocks.slice(-40); // Last 6 MBs

  return {
    orderBlocks: finalOrderBlocks,
    fvgs: finalFvgs,
    sweeps: sweeps.slice(-60),
    eqhEqls: eqhEqls.slice(-40),
    structures: finalStructures,
    mitigationBlocks: finalMitBlock,
  };
}
