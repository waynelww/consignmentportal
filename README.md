This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Event Target Calculator (`/admin/events/targets`)

Sets per-person, per-day sales targets for booth crews. The event level
(small RM500 / medium RM800 / major RM1,200 per head per day — editable in
the module's Settings) times the total crew-days gives the Tier 2 team
target; Tier 1 = 70% and Tier 3 = 150% of it. Day weights split the event
across days (3-day default 25/40/35, 2-day 55/45), and each day's slice is
divided by that day's crew and rounded to RM10 to give the number each
part-timer must ring up. A cover-ratio flag warns when the team target is
below 2× the event's fixed cost (rental + delivery + other + crew wages).
Locking an event freezes the announced targets (unlock is admin-only and
audited); the after-event review (actual sales, Tier 2 hits, notes) stays
editable. All derived numbers are recalculated server-side on save —
`lib/events/target-calc.ts` is the single source of the maths, pinned by
`scripts/test-event-target-calc.ts` (run with `npx tsx`).
