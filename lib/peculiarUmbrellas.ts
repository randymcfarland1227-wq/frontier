import { loadSelfItems, saveSelfItems, type SelfItem } from './adapters/self';
import { loadLanes, pinKey, saveLanes, type BeforeStep } from './priorityPins';

/**
 * 2026-10-22: Randy's Peculiar Candle umbrella tasks. Each is a starred Self task (not pinned) with
 * its pieces as subtasks (never counted in task totals). Seeded once; after that they're his to
 * edit or delete, so a deleted one is never brought back.
 */
const FLAG = 'lifehub-peculiar-umbrellas-v1';

type Umbrella = { id: string; title: string; detail: string; subs: string[] };

const UMBRELLAS: Umbrella[] = [
  {
    id: 'self-pc-store-brand',
    title: 'Peculiar storefront: brand offering',
    detail: 'The site has to say reclaimed vessels are safe, tested, ornate and one of a kind — never cheap.',
    subs: [
      'Say plainly that every reclaimed vessel is cleaned, inspected and burn-tested',
      'Show it: before/after vessel photos and a "what might arrive" gallery',
      'Value story: one of a kind, ornate, saves a vessel from the landfill (specific, not vague green talk)',
      'Safety line near the product: tested wick, wax and fire-safety label',
      'Check the tone across the homepage, collections, builder and About page — no discount feel',
      'Read the whole site on a phone as a first-time buyer',
      'Make the value proposition inviting at first glance: headline, one-line promise, first screen',
    ],
  },
  {
    id: 'self-pc-store-ingredients',
    title: 'Peculiar storefront: ingredient story',
    detail: '100% soy wax and clean-science fragrance are expensive — it is a luxury product. Make it known without plastering it everywhere.',
    subs: [
      'Name the wax once, clearly: 100% soy',
      'Name the fragrance source: clean-science fragrance oils',
      'One short "what is in it" block on each scent page',
      'Add it to About and the FAQ, not every banner',
      'Match the ingredient wording to the label and the SDS / IFRA records',
    ],
  },
  {
    id: 'self-pc-final-pricing',
    title: 'Peculiar final pricing',
    detail: 'Real landed costs first, then true cost, margin and retail price for Regular and Large.',
    subs: [
      'Wax: cost per ounce, landed',
      'Fragrance: cost per ounce of oil',
      'Wick, closure and label: per candle',
      'Vessel: per jar, landed, plus reclaimed prep labor',
      'Packaging and shipping materials: per order',
      'Payment fees and your labor rate',
      'Update the Costs page with the real numbers',
      'True cost, margin and retail price by size (Regular, Large)',
    ],
  },
  {
    id: 'self-pc-return-credit',
    title: 'Peculiar return vessel credit',
    detail: 'Decide how the vessel return credit works before it goes on the site or a card.',
    subs: [
      'Decide the credit: amount, and credit or refund',
      'Decide the window — only while the candle is unused and unburned',
      'Decide the local pilot (Towson / Baltimore) before anything national',
      'Write the policy line for the storefront and checkout',
      'Design the return-program card',
      'Ask interview customers whether the credit interests them',
    ],
  },
  {
    id: 'self-pc-fire-testing',
    title: 'Peculiar fire testing and logging',
    detail: 'Auditable burn records: every test logged with date and time, with photos at set points.',
    subs: [
      'Pick the standard to follow (candle fire-safety standard) and write it down',
      'Burn-test log template: date, start and end time, vessel, wax, wick, fragrance',
      'Record each burn: flame height, melt-pool depth, glass temperature, pass or fail',
      'Photos at start, one hour, and end of every test',
      'Pass/fail rules written down',
      'Back-fill the burns already done: dates, photos, results',
      'SDS and IFRA on file for every oil and the wax',
      'Batch code format, QC checklist and release checklist',
    ],
  },
  {
    id: 'self-pc-marketing',
    title: 'Peculiar marketing channels',
    detail: 'Decide where Peculiar shows up first and how — channels, cadence and what each one is for.',
    subs: [
      'Decide the launch channels: owned storefront, TikTok, Instagram, local markets (wholesale is out for now)',
      'For each channel: its job, how often you post, and who it is for',
      'Decide what goes on each channel first (process, vessel reveals, before/afters)',
      'Budget for each channel — organic only, or any paid',
      'Waitlist signup on the storefront and on the profiles',
      'Launch content bank and launch-week posting schedule',
    ],
  },
  {
    id: 'self-pc-staging-photos',
    title: 'Peculiar staging and product photos',
    detail: 'A shot guide first, then shoot every object and candle so the site shows the real things.',
    subs: [
      'Write the shot guide: how many photos per item and which angles (front, 45°, top, detail, label, scale)',
      'Decide the shot types: solo, group, combinations, in-use / lifestyle',
      'Set the lighting, backdrop and props, and keep them the same for every item',
      'List every object and item to stage',
      'Shoot vessels (before and after) and finished candles',
      'Name and sort the files so the site can use them',
      'Put the photos on the storefront: collections, scent pages, builder',
    ],
  },
  {
    id: 'self-pc-business-setup',
    title: 'Peculiar business setup and insurance',
    detail: 'EIN, banking, tax and insurance — and fire insurance is recommended, so decide what is affordable.',
    subs: [
      'EIN: get it and record the number',
      'Business checking: open it and record where',
      'Maryland sales tax registration',
      'Home-business rules for the county',
      'Fire / product liability insurance: get quotes',
      'Decide what is affordable and whether to launch before it is in place',
      'Trademark search (USPTO, Class 4)',
    ],
  },
  {
    id: 'self-pc-vessels',
    title: 'Peculiar vessel supply',
    detail: 'The vessel situation is the last big thing: stock, prep and how many are ready to sell.',
    subs: [
      'Count and measure current vessel stock, and sort by diameter and profile',
      'Decide the reclaimed vs recycled split for launch',
      'Clean and prep process written down, with time per jar',
      'Decide how many sellable vessels the first batch needs, plus a replacement reserve',
      'Decide the sourcing plan for more vessels',
    ],
  },
  {
    id: 'self-pc-packing-shipping',
    title: 'Peculiar packaging and shipping',
    detail: 'Tissue paper and boxes, a shipping agent, and a shipping policy that works.',
    subs: [
      'Buy tissue paper',
      'One-candle and multi-candle boxes: size and source',
      'Padding, inserts and odd-shape protection',
      'Drop test and packed weights',
      'Choose the carrier and the shipping agent',
      'Connect the shipping agent into the backend',
      'Decide who pays shipping and the hot-weather rule',
      'Decide what happens to damaged orders',
    ],
  },
  {
    id: 'self-pc-backend-sweep',
    title: 'Peculiar backend sweep',
    detail: 'Walk through the whole owner backend once and fix what is off.',
    subs: [
      'Check orders, stock and ingredients records',
      'Check the Stripe connection and webhook',
      'Check expenses and the ledger',
      'Check the vessel and pour/test/cure pipeline pages',
      'List what is broken or missing and fix it',
    ],
  },
];

export function seedPeculiarUmbrellas() {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(FLAG)) return;
    const now = new Date().toISOString();
    const items = loadSelfItems();
    const lanes = loadLanes();
    const fresh: SelfItem[] = [];
    UMBRELLAS.forEach(u => {
      if (items.some(x => x.id === u.id)) return;
      fresh.push({ id: u.id, title: u.title, detail: u.detail, done: false, starred: true, createdAt: now, updatedAt: now });
      const subs: BeforeStep[] = u.subs.map((text, n) => ({ id: `${u.id}-${n}`, text, done: false }));
      lanes[pinKey('self', u.id)] = { lane: null, order: 0, at: now, subs };
    });
    if (fresh.length) {
      saveSelfItems([...fresh, ...items]);
      saveLanes(lanes);
    }
    localStorage.setItem(FLAG, '1');
  } catch {
    /* storage unavailable — skip */
  }
}
