"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useTrackView } from "../Analytics/useTrackView";
import ProductPhoto from "./ProductPhoto";
import { ArrowUpRight, Mail, ArrowRight, Check, Share2 } from "lucide-react";
import { track } from "@/services/analytics";
export type Edition = {
  id: string;
  date: string;
  title: string;
  headline: string;
  description: string;
  emoji: string;
  imageUrl?: string;
  category: string;
  priceCents: number;
  rate: number;
  verifiedAt: string;
  quoteAt: string;
  sourceUrl: string;
  merchant: string;
};
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const btcFormat = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 8 });
export function NewsletterForm() {
  const signupRef = useTrackView<HTMLElement>("newsletter_view", {
    placement: "daily",
  });
  const started = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/.netlify/functions/newsletter")
      .then((r) => r.json())
      .then((d) => setEnabled(d.sendingEnabled === true))
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    track("newsletter_submit", { placement: "daily" });
    setBusy(true);
    setMessage("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await fetch("/.netlify/functions/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          btc: data.get("btc"),
          frequency: data.get("frequency"),
          consent: data.get("consent") === "on",
          website: data.get("website"),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage(d.message);
      setSent(true);
      track("newsletter_signup", {
        placement: "daily",
        outcome: [
          "confirmation_requested",
          "early_access",
          "request_accepted",
        ].includes(d.outcome)
          ? d.outcome
          : "request_accepted",
      });
    } catch (e) {
      track("newsletter_error", {
        placement: "daily",
        outcome: "request_failed",
      });
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={signupRef} className="daily-signup" id="subscribe">
      <div>
        <span className="daily-eyebrow">
          <Mail size={15} /> THE DAILY BITCOIN
        </span>
        <h2>
          Tomorrow’s find.
          <br />
          <em>Your inbox.</em>
        </h2>
        <p>
          One surprising real thing. A checked price. A whole new way to look at
          Bitcoin.
        </p>
        <p className="daily-small">
          {enabled
            ? "Daily discoveries or one Sunday pick. You choose."
            : "Early access is open. Confirmations will arrive when email delivery launches."}
        </p>
      </div>
      <form
        onSubmit={submit}
        onFocus={() => {
          if (!started.current) {
            started.current = true;
            track("newsletter_start", { placement: "daily" });
          }
        }}
      >
        {sent ? (
          <div className="daily-success">
            <Check />
            <p role="status">{message}</p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMessage("");
              }}
            >
              Use another email
            </button>
          </div>
        ) : (
          <>
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <div className="daily-form-row">
              <label>
                BTC perspective <span>(optional)</span>
                <input
                  name="btc"
                  type="number"
                  step="0.00000001"
                  min="0.00000001"
                  max="21000000"
                  placeholder="1"
                />
              </label>
              <label>
                Send me
                <select name="frequency" defaultValue="daily">
                  <option value="daily">A daily discovery</option>
                  <option value="weekly">One Sunday pick</option>
                </select>
              </label>
            </div>
            <p className="daily-small">
              Pick a hypothetical amount. We don’t need to know what you own.
            </p>
            <div className="daily-honey" aria-hidden="true">
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <label className="daily-consent">
              <input name="consent" type="checkbox" required />I agree to
              receive The Daily Bitcoin by email. Unsubscribe anytime.
            </label>
            <button className="daily-primary" disabled={busy}>
              {busy
                ? "Saving…"
                : enabled
                  ? "Send me tomorrow’s find"
                  : "Get early access"}{" "}
              <ArrowRight size={18} />
            </button>
            <p className="daily-small">
              No wallet connection. <Link href="/privacy">Privacy & data</Link>.
            </p>
            <p role="status">{message}</p>
          </>
        )}
      </form>
    </section>
  );
}
export default function DailyBitcoin({
  initialEdition,
}: {
  initialEdition: Edition | null;
}) {
  const [editions, setEditions] = useState<Edition[]>(
    initialEdition ? [initialEdition] : [],
  );
  const [current, setCurrent] = useState<Edition | null>(initialEdition);
  const editionRef = useTrackView<HTMLDivElement>(
    "daily_view",
    { item_id: current?.id, edition_date: current?.date },
    current?.date || "none",
  );
  const amountTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(amountTimer.current), []);
  const [amount, setAmount] = useState("1");
  const [message, setMessage] = useState("");
  const [vote, setVote] = useState("");
  const [voting, setVoting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/.netlify/functions/daily-feed")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        if (d.editions?.length) {
          setEditions(d.editions);
          const requested = new URLSearchParams(location.search).get("edition");
          setCurrent(
            d.editions.find((e: Edition) => e.date === requested) ||
              d.editions[0],
          );
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);
  const n = Number(amount);
  const valid =
    amount !== "" &&
    Number.isFinite(n) &&
    n > 0 &&
    n <= 21000000 &&
    /^\d+(\.\d{1,8})?$/.test(amount);
  const units =
    current && valid
      ? Math.floor((n * current.rate * 100) / current.priceCents)
      : null;
  const archived = Boolean(
    current && current.date !== new Date().toISOString().slice(0, 10),
  );
  async function cast(choice: string) {
    if (!current) return;
    setVoting(true);
    try {
      const r = await fetch("/.netlify/functions/daily-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edition: current.date, choice }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setVote(choice);
      setMessage(d.message);
      track("daily_vote", {
        item_id: current.id,
        edition_date: current.date,
        method: choice,
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Voting unavailable.");
    } finally {
      setVoting(false);
    }
  }
  async function share() {
    if (!current) return;
    const url = `${location.origin}/daily?edition=${current.date}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Edition link copied. Your BTC amount is not included.");
      track("daily_share", { item_id: current.id, edition_date: current.date });
    } catch {
      setMessage(`Share this edition: ${url}`);
    }
  }
  return (
    <>
      <header className="daily-nav wrap">
        <Link href="/">
          bitcoin <span>/ in real life.</span>
        </Link>
        <a href="#subscribe">
          Get the daily drop <ArrowUpRight size={16} />
        </a>
      </header>
      <main className="daily-page wrap">
        <div className="daily-masthead">
          <span className="daily-eyebrow">
            REAL LISTINGS. UNREAL PERSPECTIVE.
          </span>
          <h1>
            The Daily
            <br />
            <em>Bitcoin.</em>
          </h1>
          <p>
            A little curiosity. A lot of possibility.
            <br />
            One real-world find at a time.
          </p>
        </div>
        {current ? (
          <article className="daily-edition">
            <div className="daily-edition-top">
              <span>THE FIND / {current.date}</span>
              <span>{archived ? "FROM THE ARCHIVE" : "PRICE CHECKED"}</span>
            </div>
            <div ref={editionRef} className="daily-feature">
              <div className="daily-illustration">
                <ProductPhoto src={current.imageUrl} alt={current.title} />
                <small>PRODUCT PHOTO · {current.merchant}</small>
                <div className="daily-sticker">
                  REAL ITEM.
                  <br />
                  REAL PRICE.
                </div>
              </div>
              <div className="daily-story">
                <span className="daily-eyebrow">{current.category}</span>
                <h2>{current.headline}</h2>
                <p>{current.description}</p>
                <h3>{current.title}</h3>
                <p className="daily-list-price">
                  {money(current.priceCents / 100)}{" "}
                  <span>at {current.merchant}</span>
                </p>
                <a
                  href={current.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    track("daily_merchant_click", {
                      item_id: current.id,
                      edition_date: current.date,
                    })
                  }
                >
                  See the actual listing <ArrowUpRight size={17} />
                </a>
              </div>
            </div>
            <div className="daily-math">
              <label>
                TRY A BTC AMOUNT
                <input
                  aria-label="Hypothetical Bitcoin amount"
                  type="number"
                  min="0.00000001"
                  max="21000000"
                  step="0.00000001"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setAmount(raw);
                    clearTimeout(amountTimer.current);
                    if (
                      /^\d+(\.\d{1,8})?$/.test(raw) &&
                      Number(raw) > 0 &&
                      Number(raw) <= 21000000
                    )
                      amountTimer.current = setTimeout(
                        () =>
                          track("daily_amount_changed", {
                            item_id: current.id,
                            edition_date: current.date,
                          }),
                        1000,
                      );
                  }}
                />
              </label>
              <div>
                <small>PRICE EQUIVALENT</small>
                <strong>
                  {units === null ? "—" : units.toLocaleString("en-US")}
                </strong>
                <span>
                  {units === 1 ? "unit" : "units"} at the listed price
                </span>
              </div>
              <div>
                <small>ONE ITEM IN BITCOIN</small>
                <strong className="daily-btc">
                  {btcFormat(current.priceCents / 100 / current.rate)}
                </strong>
                <span>BTC per item</span>
              </div>
            </div>
            {!valid && (
              <p role="alert">
                Enter a positive amount with up to eight decimals.
              </p>
            )}
            <p className="daily-proof">
              Listing checked{" "}
              {new Date(current.verifiedAt).toLocaleString("en-US", {
                timeZone: "UTC",
              })}{" "}
              UTC · BTC/USD {money(current.rate)} at publication.{" "}
              {archived
                ? "This is a historical snapshot; check the seller for current price and availability. "
                : ""}
              Excludes tax, shipping and exchange fees. Bulk stock and Bitcoin
              payment acceptance are not implied.
            </p>
            <div className="daily-voting">
              <div>
                <h3>Would you trade it?</h3>
                <p>The item or the Bitcoin. Your call.</p>
              </div>
              <button
                disabled={voting}
                aria-pressed={vote === "trade"}
                onClick={() => cast("trade")}
              >
                Give me the {current.emoji}
              </button>
              <button
                disabled={voting}
                aria-pressed={vote === "hold"}
                onClick={() => cast("hold")}
              >
                Keep the Bitcoin ₿
              </button>
              <button aria-label="Copy edition link" onClick={share}>
                <Share2 size={19} />
              </button>
            </div>
            <p className="daily-small" role="status">
              {message}
            </p>
          </article>
        ) : (
          <div className="daily-empty">
            <h2>
              {loaded
                ? "The next find is being checked."
                : "Finding your daily dose of perspective…"}
            </h2>
            <p>
              We only publish when the source price and availability check out.
            </p>
          </div>
        )}
        <NewsletterForm />
        <section className="daily-archive">
          <span className="daily-eyebrow">THE RABBIT HOLE</span>
          <h2>Previously, in real life.</h2>
          {editions.length ? (
            <div className="daily-archive-grid">
              {editions.map((e) => (
                <button
                  key={e.date}
                  onClick={() => {
                    track("daily_archive_opened", {
                      item_id: e.id,
                      edition_date: e.date,
                    });
                    setCurrent(e);
                    setVote("");
                    setMessage("");
                    history.replaceState(null, "", `/daily?edition=${e.date}`);
                    document
                      .querySelector(".daily-edition")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <span>{e.emoji}</span>
                  <small>{e.date}</small>
                  <h3>{e.title}</h3>
                  <p>
                    {money(e.priceCents / 100)} ·{" "}
                    {btcFormat(e.priceCents / 100 / e.rate)} BTC
                  </p>
                  <ArrowUpRight />
                </button>
              ))}
            </div>
          ) : (
            <p>The archive starts with our first verified edition.</p>
          )}
        </section>
        <footer className="daily-footer">
          <Link href="/">Explore the calculator ↗</Link>
          <Link href="/privacy">Privacy</Link>
          <p>Price perspective, delivered with curiosity.</p>
        </footer>
      </main>
    </>
  );
}
