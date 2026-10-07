"use client";
import { useTrackView } from "../Analytics/useTrackView";
import LiveGame from "../play/LiveGame";
import ProductPhoto from "./ProductPhoto";
import type { Edition } from "./DailyBitcoin";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Check,
  Copy,
  Download,
  Share2,
  X,
  SlidersHorizontal,
  Bookmark,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  comparisons,
  parseBtc,
  buyingPower,
  parseSharedComparison,
  type Comparison,
} from "@/services/purchasingPower";
import { type MarketData } from "@/services/marketData";
import { track } from "@/services/analytics";
import ItemArt from "./ItemArt";

const usd = (n: number, cents = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const categories = [
  "Everything",
  "Everyday",
  "Tech & toys",
  "Experiences",
  "Big dreams",
];

export default function PurchasingPower({
  initialData,
  dailyEdition,
}: {
  initialData: MarketData;
  dailyEdition: Edition;
}) {
  const teaserRef = useTrackView<HTMLElement>(
    "daily_teaser_view",
    {
      item_id: dailyEdition.id,
      edition_date: dailyEdition.date,
      placement: "homepage",
    },
    dailyEdition.date,
  );
  const calculatorRef = useTrackView<HTMLElement>("section_view", {
    section: "calculator",
  });
  const comparisonsRef = useTrackView<HTMLElement>("section_view", {
    section: "comparisons",
  });
  const [market, setMarket] = useState(initialData);
  const [amount, setAmount] = useState("1");
  const [category, setCategory] = useState("Everything");
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Comparison | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sharePick, setSharePick] = useState("coffee");
  const [editBudget, setEditBudget] = useState("");
  const [notice, setNotice] = useState("");
  const [goalName, setGoalName] = useState("My next adventure");
  const [goalCost, setGoalCost] = useState("5000");
  const [goalSaved, setGoalSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const refreshLock = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const modal = useRef<HTMLDivElement>(null);
  const amountTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const btc = parseBtc(amount);
  const rate = market.quote?.rates.USD ?? null;
  const value = btc !== null && rate !== null ? btc * rate : null;
  const featured =
    comparisons.find((item) => item.id === sharePick) || comparisons[0];
  const budgetFor = (item: Comparison) => budgets[item.id] ?? item.budget;
  const powerFor = (item: Comparison) =>
    btc === null ? null : buyingPower(btc, rate, budgetFor(item));
  const sharePower = powerFor(featured);
  const goal = btc === null ? null : buyingPower(btc, rate, Number(goalCost));
  const lastClose = market.history[market.history.length - 1]?.price;
  const dailyChange = rate && lastClose ? (rate / lastClose - 1) * 100 : null;

  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      const response = await fetch("/api/market-data", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const next: MarketData = await response.json();
      setMarket((old) => ({
        ...next,
        quote: next.quote ?? old.quote,
        history: next.historyError ? old.history : next.history,
      }));
    } catch {
      setMarket((old) => ({ ...old, quoteError: true }));
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const shared = parseSharedComparison(location.hash);
    if (shared) {
      setAmount(shared.amount);
      setSharePick(shared.pick);
      setBudgets({ [shared.pick]: shared.budget });
      setNotice("Someone sent you a little perspective. Make it your own.");
    }
    try {
      const stored = JSON.parse(
        localStorage.getItem("bitcoin-buy-goal") || "null",
      );
      if (
        stored &&
        typeof stored.name === "string" &&
        stored.name.length <= 60 &&
        Number(stored.cost) > 0 &&
        Number(stored.cost) <= 1e12
      ) {
        setGoalName(stored.name);
        setGoalCost(String(stored.cost));
        setGoalSaved(true);
        if (
          !shared &&
          typeof stored.amount === "string" &&
          parseBtc(stored.amount) !== null
        )
          setAmount(stored.amount);
      }
    } catch {
      /* Storage is optional. */
    }
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      clearInterval(interval);
      clearTimeout(amountTimer.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected && !sharing) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setSharing(false);
      }
      if (event.key === "Tab") {
        const nodes = modal.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select, a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keyHandler);
      previousFocus.current?.focus();
    };
  }, [selected, sharing]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function updateAmount(raw: string) {
    setAmount(raw);
    setGoalSaved(false);
    clearTimeout(amountTimer.current);
    if (parseBtc(raw) !== null)
      amountTimer.current = setTimeout(() => track("calculator_used"), 1000);
  }
  function openItem(item: Comparison) {
    setSelected(item);
    setEditBudget(String(budgetFor(item)));
    track("comparison_opened", { item_id: item.id });
  }
  function openShare(item?: Comparison) {
    if (item) setSharePick(item.id);
    setSharing(true);
    track("share_opened", { item_id: item?.id || sharePick });
  }
  function shareUrl() {
    const params = new URLSearchParams({
      btc: amount,
      pick: featured.id,
      budget: String(budgetFor(featured)),
    });
    return `${location.origin}/#${params}`;
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setNotice("Link copied. Go give someone perspective.");
      track("share_link_copied", { item_id: featured.id });
    } catch {
      setNotice("Clipboard unavailable. Copy the link from the field below.");
    }
  }
  async function nativeShare() {
    try {
      await navigator.share({
        title: "Bitcoin, but make it real.",
        text: `What could ${amount} BTC buy?`,
        url: shareUrl(),
      });
      track("native_share_completed", { item_id: featured.id });
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setNotice("Sharing unavailable. You can copy the link instead.");
    }
  }
  async function downloadCard() {
    if (!sharePower || !market.quote) return;
    setDownloadBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const c = canvas.getContext("2d");
      if (!c) throw new Error();
      const fitText = (
        text: string,
        x: number,
        y: number,
        maxSize: number,
        width = 1060,
      ) => {
        let size = maxSize;
        c.font = `bold ${size}px Arial`;
        while (c.measureText(text).width > width && size > 16) {
          size -= 1;
          c.font = `bold ${size}px Arial`;
        }
        c.fillText(text, x, y);
      };
      c.fillStyle = "#171817";
      c.fillRect(0, 0, 1200, 1200);
      c.fillStyle = "#dcf85b";
      c.beginPath();
      c.arc(1050, 180, 250, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#171817";
      c.font = "bold 210px Arial";
      c.fillText("₿", 945, 250);
      c.fillStyle = "#f5f5ee";
      c.font = "bold 30px Arial";
      c.fillText("BITCOIN / IN REAL LIFE", 70, 95);
      fitText(
        `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC could buy`,
        70,
        335,
        78,
        850,
      );
      const headline =
        sharePower.units >= 1
          ? number(sharePower.units)
          : `${sharePower.progress.toFixed(1)}%`;
      c.fillStyle = "#dcf85b";
      fitText(headline, 65, 545, 155);
      c.fillStyle = "#f5f5ee";
      fitText(
        sharePower.units >= 1
          ? featured.title.toLowerCase()
          : `of a ${featured.singular}`,
        70,
        650,
        74,
      );
      c.fillStyle = "#a5a79e";
      c.font = "28px Arial";
      c.fillText("Same bitcoin. A different kind of rich.", 70, 755);
      c.fillStyle = "#35372d";
      c.fillRect(70, 835, 1060, 2);
      c.fillStyle = "#f5f5ee";
      c.font = "24px Arial";
      fitText(
        `Illustrative budget: ${usd(budgetFor(featured), true)} each · Before fees and tax`,
        70,
        900,
        24,
      );
      c.fillText(
        `BTC/USD: ${usd(market.quote.rates.USD, true)} · Retrieved ${market.quote.fetchedAt.slice(0, 10)} UTC`,
        70,
        945,
      );
      c.fillStyle = "#dcf85b";
      c.font = "bold 30px Arial";
      c.fillText("WHATSBITCOINSPRICE.COM", 70, 1090);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bitcoin-${featured.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      track("share_card_downloaded", { item_id: featured.id });
      setNotice("Your share card is ready.");
    } catch {
      setNotice("Could not create the image. Try copying the link instead.");
    } finally {
      setDownloadBusy(false);
    }
  }
  function saveGoal() {
    if (!goal || !goalName.trim() || Number(goalCost) > 1e12) {
      setNotice("Give your goal a name and a positive USD budget.");
      return;
    }
    try {
      localStorage.setItem(
        "bitcoin-buy-goal",
        JSON.stringify({
          name: goalName.trim(),
          cost: Number(goalCost),
          amount,
        }),
      );
      setGoalSaved(true);
      setNotice("Goal saved on this device. Come back to see what changes.");
      track("goal_saved");
    } catch {
      setNotice(
        "Your browser could not save this goal. You can still use the calculator.",
      );
    }
  }

  return (
    <div className="buy-app">
      <header className="site-nav wrap">
        <Link href="/" className="brand" aria-label="Bitcoin in real life home">
          <span className="brand-coin">₿</span>
          <span>
            bitcoin<span className="brand-sub">in real life.</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link
            href="#play"
            onClick={() => track("game_entry", { placement: "navigation" })}
          >
            Play live
          </Link>
          <Link href="/daily">The Daily Bitcoin</Link>
          <a href="#how-it-works">How it works</a>
          <Link href="/price" className="nav-price">
            Price chart <ArrowUpRight size={14} />
          </Link>
        </nav>
        <button
          className="button small dark"
          onClick={() => openShare()}
          disabled={value === null}
        >
          Share the perspective <ArrowUpRight size={15} />
        </button>
      </header>
      <main>
        <LiveGame embedded />
        <aside ref={teaserRef} className="wrap daily-teaser-wrap">
          <Link
            className="daily-teaser"
            href={`/daily?edition=${dailyEdition.date}`}
            onClick={() =>
              track("daily_teaser_click", {
                item_id: dailyEdition.id,
                edition_date: dailyEdition.date,
                placement: "homepage",
              })
            }
          >
            <div className="daily-teaser-copy">
              <span className="daily-teaser-label">
                <i /> THE DAILY BITCOIN / LATEST FIND
              </span>
              <h2>
                Yes, this is real.
                <br />
                <em>Guess the Bitcoin price.</em>
              </h2>
              <p>One unexpected find. A real store. A price you have to see.</p>
              <span className="daily-teaser-button">
                Reveal the daily find <ArrowUpRight size={20} />
              </span>
              <small>New finds daily · No signup needed to explore</small>
            </div>
            <div className="daily-teaser-photo">
              <ProductPhoto
                src={dailyEdition.imageUrl}
                alt="A preview of the latest real-world Bitcoin find"
              />
              <span className="daily-teaser-tag">WAIT. HOW MUCH IN ₿?</span>
            </div>
          </Link>
        </aside>
        <section className="hero wrap">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="yellow-line" /> LESS CHARTS. MORE POSSIBILITIES.
            </div>
            <h2>
              Bitcoin.
              <br />
              But make it
              <br />
              <span className="real-word">
                real life.
                <svg viewBox="0 0 400 20" aria-hidden="true">
                  <path d="M4 12Q210 0 392 9M45 18Q200 7 370 14" />
                </svg>
              </span>
            </h2>
            <p className="hero-description">
              You know the price.
              <br />
              Now see the possibilities.
            </p>
            <a className="hero-link" href="#calculator">
              Find your kind of rich{" "}
              <span>
                <ArrowDown size={18} />
              </span>
            </a>
          </div>
          <div className="hero-art">
            <Image
              src="/images/bitcoin-real-life.png"
              alt="A sculptural Bitcoin coin surrounded by a coffee cup, a home, a car and an airplane"
              width={1024}
              height={1024}
              sizes="(max-width: 760px) 100vw, 52vw"
            />
            <span className="art-caption">
              ONE BITCOIN. A WORLD OF WHAT-IFS.
            </span>
            <span className="orbit-tag">₿ → IRL</span>
          </div>
        </section>
        <div className="ticker">
          <div className="wrap ticker-inner">
            <span>
              <i
                className={
                  market.quoteError ? "status-dot warning" : "status-dot"
                }
              />
              {market.quoteError ? "LAST RETRIEVED QUOTE" : "BTC / USD"}
            </span>
            <strong>
              {rate ? usd(rate, true) : "Temporarily unavailable"}
            </strong>
            {dailyChange !== null && !market.quoteError && (
              <span className={dailyChange >= 0 ? "positive" : "negative"}>
                {dailyChange >= 0 ? "+" : ""}
                {dailyChange.toFixed(2)}%{" "}
                <span className="ticker-context">since last daily close</span>
              </span>
            )}
            <span className="ticker-end">
              A little perspective goes a long way. <Zap size={14} />
            </span>
          </div>
        </div>
        <section
          className="calculator wrap"
          ref={calculatorRef}
          id="calculator"
        >
          <div className="section-kicker">01 / YOUR STARTING POINT</div>
          <div className="calculator-grid">
            <div>
              <h2>
                What are you
                <br />
                working with?
              </h2>
              <p>Try an amount. It doesn’t have to be yours.</p>
            </div>
            <div className="amount-panel">
              <label htmlFor="btc-amount">IF I HAD</label>
              <div className="amount-input">
                <input
                  id="btc-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => updateAmount(e.target.value)}
                  aria-describedby="amount-help"
                  aria-invalid={btc === null}
                  maxLength={18}
                />
                <span>BTC</span>
              </div>
              <div className="amount-bottom">
                <div className="presets">
                  {["0.01", "0.1", "1", "10"].map((preset) => (
                    <button
                      key={preset}
                      aria-pressed={amount === preset}
                      onClick={() => updateAmount(preset)}
                    >
                      {preset} BTC
                    </button>
                  ))}
                </div>
                <span>
                  {value !== null ? `≈ ${usd(value)}` : "—"}{" "}
                  <span className="muted">USD</span>
                </span>
              </div>
              <p
                id="amount-help"
                className={btc === null ? "input-error" : "fine-print"}
              >
                {btc === null
                  ? "Enter 0–21 million BTC, with up to 8 decimal places."
                  : "No wallet. No sign-up. Just a different way to see it."}
              </p>
            </div>
          </div>
          {market.quoteError && (
            <p className="data-warning" role="status">
              {rate
                ? "Quote refresh failed. These comparisons use the last retrieved price."
                : "Bitcoin prices are temporarily unavailable. Comparisons will return when prices are available."}{" "}
              <button onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw size={13} /> Retry
              </button>
            </p>
          )}
        </section>
        <section
          className="possibilities wrap"
          ref={comparisonsRef}
          id="possibilities"
        >
          <div className="section-heading">
            <div>
              <div className="section-kicker">02 / THE POSSIBILITIES</div>
              <h2>
                Same bitcoin.
                <br className="mobile-break" /> Different kind of rich
                <span className="yellow-text">.</span>
              </h2>
            </div>
            <span className="tiny-label">
              BIG DREAMS. SMALL PLEASURES.
              <ArrowDown size={15} />
            </span>
          </div>
          <div className="filter-row">
            <div className="category-tabs" aria-label="Comparison categories">
              {categories.map((cat) => (
                <button
                  key={cat}
                  aria-pressed={category === cat}
                  onClick={() => {
                    setCategory(cat);
                    track("category_selected", { category: cat });
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            <span className="benchmark-label">
              <SlidersHorizontal size={13} /> Your prices, your reality
            </span>
          </div>
          <div className="comparison-grid">
            {comparisons
              .filter(
                (item) =>
                  category === "Everything" || item.category === category,
              )
              .map((item, index) => {
                const power = powerFor(item);
                return (
                  <article
                    className={`comparison-card ${item.color}`}
                    key={item.id}
                    style={{ animationDelay: `${index * 45}ms` }}
                  >
                    <button
                      className="card-main"
                      onClick={() => openItem(item)}
                      aria-label={`Explore ${item.title}`}
                    >
                      <div className="card-top">
                        <span>{item.category}</span>
                        <ArrowUpRight size={18} />
                      </div>
                      <ItemArt icon={item.icon} />
                      <div className="card-value">
                        {power
                          ? power.units >= 1
                            ? number(power.units)
                            : `${power.progress > 0 && power.progress < 0.1 ? "<0.1" : power.progress.toFixed(1)}%`
                          : "—"}
                      </div>
                      <h3>
                        {power && power.units < 1
                          ? `of a ${item.singular}`
                          : item.title}
                      </h3>
                      <p className="card-caption">
                        {item.id === "coffee"
                          ? "Your morning ritual. On repeat."
                          : item.id === "pizza"
                            ? "The good kind of portfolio."
                            : item.id === "laptop"
                              ? "A fresh start, fully charged."
                              : item.id === "getaway"
                                ? "Less screen time. More sunsets."
                                : item.id === "sneakers"
                                  ? "Put a little wealth in your step."
                                  : item.id === "dinner"
                                    ? "Make a night of it."
                                    : item.id === "car"
                                      ? "Take the scenic route."
                                      : "A different kind of address."}
                      </p>
                    </button>
                    <div className="card-footer">
                      <button onClick={() => openItem(item)}>
                        {usd(budgetFor(item), true)} example budget{" "}
                        <SlidersHorizontal size={11} />
                      </button>
                      <button
                        className="card-share"
                        aria-label={`Share ${item.title} comparison`}
                        disabled={!power}
                        onClick={() => openShare(item)}
                      >
                        <Share2 size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
          <p className="comparison-note">
            <span>↳</span> A little imagination, not a shopping quote. These are
            editable example budgets. Prices exclude fees and taxes.{" "}
            <a href="#how-it-works">
              Here’s the math <ArrowUpRight size={12} />
            </a>
          </p>
        </section>
        <section className="goal-section wrap" id="your-goal">
          <div className="goal-copy">
            <div className="section-kicker">03 / MAKE IT PERSONAL</div>
            <span className="goal-scribble" aria-hidden="true">
              ✳
            </span>
            <h2>
              What’s <em>your</em>
              <br />
              next big thing?
            </h2>
            <p>
              A first car. A year off. That thing you keep talking about.
              <br />
              Put a price on it. See it in bitcoin.
            </p>
          </div>
          <div className="goal-panel">
            <div className="goal-panel-top">
              <span>THE SOMEDAY FUND</span>
              <Bookmark size={17} />
            </div>
            <label htmlFor="goal-name">I’m dreaming of</label>
            <input
              id="goal-name"
              maxLength={60}
              value={goalName}
              onChange={(e) => {
                setGoalName(e.target.value);
                setGoalSaved(false);
              }}
            />
            <label htmlFor="goal-cost">My budget (USD)</label>
            <div className="goal-money">
              <span>$</span>
              <input
                id="goal-cost"
                type="number"
                min="1"
                max="1000000000000"
                value={goalCost}
                onChange={(e) => {
                  setGoalCost(e.target.value);
                  setGoalSaved(false);
                }}
              />
            </div>
            <div className="goal-result">
              <span>
                {goal
                  ? `${goal.btcNeeded.toLocaleString("en-US", { maximumFractionDigits: 6 })} BTC`
                  : "Set your budget"}
              </span>
              <strong>{goal ? `${goal.progress.toFixed(1)}%` : "—"}</strong>
            </div>
            <div
              className="goal-progress"
              role="progressbar"
              aria-label="Goal funded by hypothetical BTC amount"
              aria-valuenow={goal?.progress || 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${goal?.progress || 0}%` }} />
            </div>
            <p className="fine-print">
              {goal && goal.progress >= 100
                ? "Your hypothetical amount covers this budget."
                : "Based on the hypothetical BTC amount above."}
            </p>
            <button className="button yellow" onClick={saveGoal}>
              {goalSaved ? (
                <>
                  <Check size={16} /> Saved on this device
                </>
              ) : (
                <>
                  <Plus size={16} /> Save my someday
                </>
              )}
            </button>
            <p className="goal-private">
              Only saved in this browser. No account needed.
            </p>
          </div>
        </section>
        <section className="share-banner wrap">
          <div>
            <span className="section-kicker">PERSPECTIVE IS BETTER SHARED</span>
            <h2>
              Send someone
              <br />a little “what if.”
            </h2>
            <p>Make a card. Start a conversation.</p>
          </div>
          <button
            className="button yellow"
            disabled={value === null}
            onClick={() => openShare()}
          >
            Make my share card <ArrowUpRight size={18} />
          </button>
          <span className="banner-star" aria-hidden="true">
            ✳
          </span>
        </section>
        <section className="how-section wrap" id="how-it-works">
          <div>
            <div className="section-kicker">NO MYSTERY MATH</div>
            <h2>
              A price. A possibility.
              <br />A little perspective.
            </h2>
          </div>
          <div className="how-details">
            <p>
              We multiply your hypothetical BTC amount by the latest retrieved
              Coinbase USD exchange rate, then divide by each example budget.
              Whole items are rounded down; smaller amounts show the percentage
              of one item you could cover.
            </p>
            <p>
              The budgets are illustrations, not live product listings, price
              surveys or offers. Tap any card to change its budget. Comparisons
              exclude selling fees, taxes and purchase costs.
            </p>
            <p className="data-source">
              Price source:{" "}
              <a
                href="https://www.coinbase.com/price/bitcoin"
                target="_blank"
                rel="noopener noreferrer"
              >
                Coinbase <ArrowUpRight size={12} />
              </a>
              {market.quote && (
                <>
                  {" "}
                  · Retrieved{" "}
                  <time dateTime={market.quote.fetchedAt}>
                    {market.quote.fetchedAt
                      .replace("T", " ")
                      .replace(".000Z", " UTC")}
                  </time>
                </>
              )}
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh Bitcoin rate"
              >
                <RefreshCw size={13} className={refreshing ? "spin" : ""} />
              </button>
            </p>
            <Link href="/price" className="text-link">
              Explore the price history <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="site-footer wrap">
        <Link href="/" className="brand">
          <span className="brand-coin">₿</span>
          <span>
            bitcoin<span className="brand-sub">in real life.</span>
          </span>
        </Link>
        <p>Less watching the numbers. More imagining the possibilities.</p>
        <Link href="/privacy">Privacy</Link>
        <span>© {new Date().getFullYear()}</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {(selected || sharing) && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelected(null);
              setSharing(false);
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            ref={modal}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => {
                setSelected(null);
                setSharing(false);
              }}
            >
              <X size={22} />
            </button>
            {selected ? (
              <>
                <span className="section-kicker">MAKE THE MATH YOURS</span>
                <h2 id="modal-title">{selected.title}</h2>
                <div className={`modal-art ${selected.color}`}>
                  <ItemArt icon={selected.icon} />
                </div>
                <p>{selected.note}</p>
                <label htmlFor="edit-budget">Your price per item (USD)</label>
                <input
                  id="edit-budget"
                  type="number"
                  min="0.01"
                  max="1000000000000"
                  step="0.01"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                />
                <button
                  className="button yellow"
                  disabled={
                    !(Number(editBudget) > 0 && Number(editBudget) <= 1e12)
                  }
                  onClick={() => {
                    setBudgets((old) => ({
                      ...old,
                      [selected.id]: Number(editBudget),
                    }));
                    track("benchmark_updated", { item_id: selected.id });
                    setSelected(null);
                  }}
                >
                  Update my perspective <ArrowRight size={16} />
                </button>
                <button
                  className="text-link"
                  onClick={() => setEditBudget(String(selected.budget))}
                >
                  Reset to example budget
                </button>
              </>
            ) : (
              <>
                <span className="section-kicker">A LITTLE SOCIAL CURRENCY</span>
                <h2 id="modal-title">That’s a lot of possibility.</h2>
                <label htmlFor="share-pick">Pick your perspective</label>
                <select
                  id="share-pick"
                  value={sharePick}
                  onChange={(e) => setSharePick(e.target.value)}
                >
                  {comparisons.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <div className="share-card-preview">
                  <span>BITCOIN / IN REAL LIFE</span>
                  <p>{amount} BTC could buy</p>
                  <strong>
                    {sharePower
                      ? sharePower.units >= 1
                        ? number(sharePower.units)
                        : `${sharePower.progress.toFixed(1)}%`
                      : "—"}
                  </strong>
                  <h3>
                    {sharePower && sharePower.units < 1
                      ? `of a ${featured.singular}`
                      : featured.title.toLowerCase()}
                  </h3>
                  <small>
                    {usd(budgetFor(featured), true)} example budget each ·
                    Before fees and tax
                  </small>
                  <span className="share-card-brand">
                    WHATSBITCOINSPRICE.COM
                  </span>
                </div>
                <div className="share-actions">
                  <button
                    className="button yellow"
                    disabled={!sharePower}
                    onClick={() => void copyLink()}
                  >
                    <Copy size={16} /> Copy link
                  </button>
                  <button
                    className="button outlined"
                    disabled={!sharePower || downloadBusy}
                    onClick={() => void downloadCard()}
                  >
                    <Download size={16} />
                    {downloadBusy ? "Creating…" : "Save image"}
                  </button>
                </div>
                {typeof navigator !== "undefined" && !!navigator.share && (
                  <button
                    className="button outlined"
                    onClick={() => void nativeShare()}
                    disabled={!sharePower}
                  >
                    <Share2 size={16} /> Share…
                  </button>
                )}
                <label className="fine-print" htmlFor="share-url">
                  Shared links include your hypothetical amount and selected
                  budget. Values update with the BTC price.
                </label>
                <input
                  className="share-url"
                  id="share-url"
                  readOnly
                  value={typeof location !== "undefined" ? shareUrl() : ""}
                  onFocus={(e) => e.target.select()}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
