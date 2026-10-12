# People + Mind Map: two relationship paths

## What changes

### 1. Two paths for every person

**Business path** (people building a business):
- Prospect → Apprentice → IBO, in that order.
- Apprentice requires a **business start date**. Exactly one year later they automatically become an IBO — no action needed.
- Warning badges appear 90 days and 30 days before that anniversary, on the person's page, in the People list, and in an "Attention" list.

**Customer path**:
- A customer always belongs to one Apprentice or IBO (their "owner").
- Customers are never Prospects/Apprentices/IBOs and never have a downline of their own.
- Customer record keeps: name, contact info, owner, start date, notes, and monthly volume (used to rank "top producing" customers).

The old "Biz Class" values (IBO / Apprentice / Candidate) map over: Candidate → Prospect, others unchanged. Existing pipeline stages Showed Plan and Candidate collapse into Prospect.

### 2. People module updates
- Path filter: Business vs Customers.
- Business rows show stage, business start date, and the apprentice-anniversary warning.
- Customer rows show their owner and volume; clicking an owner jumps to that person.
- Person detail page gains a **Customers** section: list, add, edit, remove.
- People and Mind Map share **one roster** — anyone added in either place shows up in both.

### 3. Mind Map updates
- The three-dot menu on each card opens: **Add Apprentice**, **Add IBO**, **Add Customer**.
  - Apprentice / IBO are added as downline nodes of that card (business start date required for Apprentice).
  - Customer is attached to the card's owner, not drawn as a downline node.
- Each card shows up to **3 small customer circles** for its top-producing customers, plus a "show more" link when there are more.
- Customer circles are hidden by default and revealed either per card or with a global **Show customers** switch in the header.
- "Show more" opens a panel to the right of the card listing all of that person's customers.
- Adding an Apprentice or IBO recalculates the map (ordering, GPV, member counts, IDs) using the existing rules. Customers do not affect GPV or member counts.

## Technical notes
- `src/stores/peopleStore.ts`: `BizClass` becomes `"prospect" | "apprentice" | "ibo" | "customer"`; `PipelineStage` reduces to `prospect | apprentice | ibo`; add `businessStartDate`, `ownerId`, `monthlyVolume`. Add derived helpers: `effectiveBizClass(p, today)` (auto-promotes apprentice past 1 year), `apprenticeAlertLevel(p, today)` (`90d` / `30d` / `due` / null), `customersOf(id)`, `topCustomers(id, 3)`. Migrate seed data to the new values.
- Make `peopleStore` the single roster: `useTreeStore.loadRows` also syncs parsed people into `peopleStore` (business path only), and new mind-map nodes go through `peopleStore.add` plus a tree insert. Tree nodes keep matching by `id`.
- `src/components/mindmap/useTreeStore.ts`: add `addChild(parentId, { name, bizClass, businessStartDate })` that inserts a node then re-runs `normalizeForest` so sorting/GPV/memberCount/renumbering stay correct, and keeps the `expanded` set valid across renumbering (remap by identity before IDs change).
- `src/components/mindmap/NodeCard.tsx`: replace the inert `MoreHorizontal` button with a dropdown (existing shadcn `dropdown-menu`) holding the three add actions; add a customer-avatar row (3 circles + "+N more"). New `CustomerPopover`/panel component rendered beside the card, positioned from the node's `x + NODE_W`.
- Customer visibility: `showCustomers: Set<string>` plus `showAllCustomers: boolean` in the tree store; header toggle in `src/routes/mindmap.tsx`.
- Layout algorithm (X-grid, right-to-left DFS, bump-down) is untouched — customer circles render inside existing card bounds, and the customer list panel is an overlay that does not participate in layout.
- Add-person dialogs reuse the existing dialog/form patterns from `src/routes/people.tsx`; every add logs to `activityStore`.
