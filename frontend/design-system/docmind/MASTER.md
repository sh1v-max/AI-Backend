# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** DocMind
**Generated:** 2026-09-12 20:29:07
**Category:** AI/Chatbot Platform

---

## Global Rules

### Color Palette

**Updated 2026-09-12 — switched to light green + gray on user request.** Superseded the initial navy+blue palette below.

| Role | Hex (light) | Hex (dark) | CSS Variable |
|------|-------------|------------|--------------|
| Primary | `#3F3F46` | `#D4D4D8` | `--color-primary` |
| On Primary | `#FFFFFF` | `#18181B` | `--color-on-primary` |
| Secondary | `#71717A` | `#A1A1AA` | `--color-secondary` |
| Accent/CTA | `#16A34A` | `#4ADE80` | `--color-accent` |
| Accent Hover | `#15803D` | `#22C55E` | `--color-accent-hover` |
| Accent Background | `#F0FDF4` | `rgba(74,222,128,0.12)` | `--color-accent-bg` |
| Background | `#F7F8F7` | `#17191A` | `--color-background` |
| Surface | `#FFFFFF` | `#202323` | `--color-surface` |
| Foreground | `#18181B` | `#F4F4F5` | `--color-foreground` |
| Muted | `#71717A` | `#A1A1AA` | `--color-muted` |
| Muted Background | `#F1F2F1` | `#26292A` | `--color-muted-bg` |
| Border | `#E2E8E3` | `#33383A` | `--color-border` |
| Destructive | `#DC2626` | `#F87171` | `--color-destructive` |
| Ring | `#16A34A` | `#4ADE80` | `--color-ring` |

**Color Notes:** Neutral zinc-gray as the primary/text color, sage green as the single accent/interactive color (buttons, focus rings, hover states, success indicators). Contrast-verified: badge text 4.79:1, foreground/background 16.6:1, dark-mode accent 9.09:1 — all pass WCAG AA. `--color-accent` on white (3.3:1) is intentionally only used for non-text UI (borders, focus rings), which only requires 3:1.

<details>
<summary>Original palette (superseded)</summary>

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E3A5F` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#2563EB` | `--color-secondary` |
| Accent/CTA | `#059669` | `--color-accent` |
| Background | `#F8FAFC` | `--color-background` |
| Foreground | `#0F172A` | `--color-foreground` |
| Muted | `#F1F3F5` | `--color-muted` |
| Border | `#E4E7EB` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| Ring | `#1E3A5F` | `--color-ring` |

Navy professional + paid green
</details>

### Typography

- **Heading Font:** Space Grotesk
- **Body Font:** DM Sans
- **Mood:** tech, startup, modern, innovative, bold, futuristic
- **Google Fonts:** [Space Grotesk + DM Sans](https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #059669;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E3A5F;
  border: 2px solid #1E3A5F;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F8FAFC;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E3A5F;
  outline: none;
  box-shadow: 0 0 0 3px #1E3A5F20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** AI-Native UI

**Keywords:** Chatbot, conversational, voice, assistant, agentic, ambient, minimal chrome, streaming text, AI interactions

**Best For:** AI products, chatbots, voice assistants, copilots, AI-powered tools, conversational interfaces

**Key Effects:** Typing indicators (3-dot pulse), streaming text animations, pulse animations, context cards, smooth reveals

### Page Pattern

**Pattern Name:** Minimal Single Column

- **Conversion Strategy:** Single CTA focus. Large typography. Lots of whitespace. No nav clutter. Mobile-first.
- **CTA Placement:** Center, large CTA button
- **Section Order:** 1. Hero headline, 2. Short description, 3. Benefit bullets (3 max), 4. CTA, 5. Footer

---

## Anti-Patterns (Do NOT Use)

- ❌ Heavy chrome
- ❌ Slow response feedback

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
