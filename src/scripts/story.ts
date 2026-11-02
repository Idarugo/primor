import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];
const EASE = 'power3.out';

/* ---------- Smooth scroll ---------- */
let lenis: Lenis | null = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.1, anchors: { offset: 0 } });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------- One shot reveals (IntersectionObserver, B7) ---------- */
const revealIO = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), revealIO.unobserve(e.target))),
  { rootMargin: '0px 0px -10% 0px' },
);
$$('[data-reveal]').forEach((el) => revealIO.observe(el));

/* ---------- Tagline: words light up one by one as they cross the line ---------- */
const words = $$('[data-tagline] .reveal-word');
if (reduced) {
  words.forEach((w) => w.classList.add('is-on'));
} else {
  const wordIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.target.classList.toggle('is-on', e.boundingClientRect.top < window.innerHeight * 0.6)),
    { rootMargin: '0px 0px -40% 0px', threshold: [0, 1] },
  );
  words.forEach((w) => wordIO.observe(w));
}

const mm = gsap.matchMedia();

mm.add({ motion: '(prefers-reduced-motion: no-preference)', desktop: '(min-width: 768px)' }, (ctx) => {
  const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
  if (!motion) return;

  /* ---------- 1. Hero: the bag opens and the world turns yellow ---------- */
  const hero = $('[data-hero]')!;
  const bag = $('[data-hero-bag]', hero)!;
  const chips = $$('[data-chip]', hero);

  gsap.from(bag, { yPercent: 30, opacity: 0, rotate: -6, duration: 1.4, ease: EASE, delay: 0.1 });
  gsap.from('[data-hero-line]', { yPercent: 60, opacity: 0, duration: 1.2, ease: EASE, stagger: 0.12 });
  gsap.from('[data-hero-foot] > *', { y: 24, opacity: 0, duration: 1, ease: EASE, delay: 0.5, stagger: 0.1 });

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: hero, start: 'top top', end: '+=180%', pin: true, scrub: 0.8, anticipatePin: 1 },
  });
  tl.to('[data-hero-hint], [data-hero-foot]', { opacity: 0, y: 24, duration: 0.15 }, 0)
    .to('[data-hero-line="1"]', { xPercent: -70, opacity: 0, duration: 0.5 }, 0)
    .to('[data-hero-line="2"]', { xPercent: 70, opacity: 0, duration: 0.5 }, 0)
    .to(bag, { y: 0, scale: 1.05, rotateY: 14, rotate: 4, duration: 0.5, ease: 'power2.inOut' }, 0)
    .to('[data-hero-flood]', { scale: 9, duration: 0.45, ease: 'power2.in' }, 0.08)
    .to(
      chips,
      {
        x: (_, el) => `${el.dataset.x}vw`,
        y: (_, el) => `${el.dataset.y}vh`,
        rotate: (_, el) => Number(el.dataset.r),
        scaleX: (_, el) => Number(el.dataset.s),
        scaleY: (_, el) => Number(el.dataset.s) * Number(el.dataset.sy),
        duration: 0.5,
        ease: 'power3.out',
        stagger: { each: 0.008, from: 'random' },
      },
      0.3,
    )
    .to('[data-hero-beat]', { opacity: 1, y: 0, duration: 0.2 }, 0.55)
    .fromTo('[data-hero-beat]', { y: 40 }, { y: 0, duration: 0.2 }, 0.55)
    .to(bag, { rotateY: -8, rotate: -3, scale: 0.82, y: () => window.innerHeight * 0.12, duration: 0.3, ease: 'power1.inOut' }, 0.55)
    .to(chips, { y: (_, el) => `${Number(el.dataset.y) - 18}vh`, rotate: '+=60', duration: 0.3 }, 0.7)
    .to(bag, { rotate: 2, duration: 0.15 }, 0.85);

  /* ---------- 2. Story: year counter scrubs 1973 → today, images swap per chapter ---------- */
  const story = $('[data-story]')!;
  const yearEl = $('[data-year]', story)!;
  const from = Number(yearEl.textContent);
  const to = new Date().getFullYear();
  const counter = { v: from };
  gsap.to(counter, {
    v: to,
    ease: 'none',
    scrollTrigger: { trigger: story, start: 'top top', end: 'bottom bottom', scrub: true },
    onUpdate: () => (yearEl.textContent = String(Math.round(counter.v))),
  });

  const imgs = $$('[data-story-img]', story);
  $$('[data-story-step]', story).forEach((step, i) => {
    ScrollTrigger.create({
      trigger: step,
      start: 'top 60%',
      end: 'bottom 40%',
      onToggle: ({ isActive }) => {
        step.style.opacity = isActive ? '1' : '0.3';
        if (!isActive) return;
        imgs.forEach((img, j) => {
          img.style.opacity = j === i ? '1' : '0';
          img.style.transform = j === i ? 'scale(1)' : 'scale(1.05)';
        });
      },
    });
  });

  /* ---------- 3. Products: horizontal pinned track on desktop ---------- */
  const products = $('[data-products]')!;
  const track = $('[data-products-track]', products)!;
  const panels = $$('[data-product]', track);
  const count = $('[data-products-count]', products)!;

  if (desktop) {
    const distance = () => track.scrollWidth - window.innerWidth;
    const horiz = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: products,
        start: 'top top',
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const idx = Math.min(panels.length - 1, Math.round(self.progress * (panels.length - 1)));
          count.textContent = String(idx + 1).padStart(2, '0');
        },
      },
    });

    panels.forEach((panel) => {
      const img = $('[data-product-img]', panel);
      const num = $('[data-product-num]', panel);
      const pchips = $$('[data-product-chip]', panel);
      const st = { trigger: panel, containerAnimation: horiz, start: 'left right', end: 'right left', scrub: true };
      gsap.fromTo(img, { xPercent: 30, rotate: 8 }, { xPercent: -30, rotate: -8, ease: 'none', scrollTrigger: st });
      gsap.fromTo(num, { xPercent: -40 }, { xPercent: 40, ease: 'none', scrollTrigger: st });
      gsap.fromTo(pchips, { y: 80, rotate: 0 }, { y: -80, rotate: 180, ease: 'none', scrollTrigger: st });
    });
  } else {
    panels.forEach((panel) => {
      const img = $('[data-product-img]', panel);
      gsap.fromTo(img, { y: 60, rotate: 6 }, { y: -40, rotate: -4, ease: 'none', scrollTrigger: { trigger: panel, start: 'top bottom', end: 'bottom top', scrub: true } });
      ScrollTrigger.create({
        trigger: panel,
        start: 'top 50%',
        end: 'bottom 50%',
        onToggle: (s) => s.isActive && (count.textContent = String(panels.indexOf(panel) + 1).padStart(2, '0')),
      });
    });
  }

  /* ---------- 4. Marquee reacts to scroll direction and speed ---------- */
  const marquee = $('[data-marquee] .marquee-track');
  if (marquee) {
    ScrollTrigger.create({
      trigger: marquee,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        const v = self.getVelocity();
        marquee.getAnimations().forEach((a) => (a.playbackRate = gsap.utils.clamp(-4, 4, (self.direction || 1) * (1 + Math.abs(v) / 900))));
      },
    });
  }

  /* ---------- 5. Instagram wall parallax columns ---------- */
  $$('[data-parallax]').forEach((col) => {
    const amount = Number(col.dataset.parallax);
    gsap.fromTo(col, { yPercent: -amount / 2 }, { yPercent: amount, ease: 'none', scrollTrigger: { trigger: col.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  gsap.fromTo('[data-visit-box]', { y: 24, rotate: -6 }, { y: 0, rotate: 3, ease: 'none', scrollTrigger: { trigger: '#visitanos', start: 'top bottom', end: 'bottom top', scrub: true } });

  /* ---------- 6. Finale: chips rain through the yellow ---------- */
  const finale = $('[data-finale]')!;
  $$('[data-rain]', finale).forEach((chip, i) => {
    gsap.to(chip, {
      y: () => window.innerHeight * (1.6 + (i % 4) * 0.25),
      rotate: (i % 2 ? 1 : -1) * (180 + i * 30),
      ease: 'none',
      scrollTrigger: { trigger: finale, start: 'top bottom', end: 'bottom top', scrub: 0.5 + (i % 3) * 0.3 },
    });
  });

  return () => {};
});

/* ---------- Nav: mark the section in view (created after the pins so positions include pin spacing) ---------- */
$$<HTMLAnchorElement>('[data-nav-link]').forEach((a) => {
  const target = document.getElementById(a.hash.slice(1));
  if (!target) return;
  ScrollTrigger.create({
    trigger: target,
    start: 'top 50%',
    end: 'bottom 50%',
    onToggle: (self) => a.setAttribute('aria-current', String(self.isActive)),
  });
});

window.addEventListener('load', () => ScrollTrigger.refresh());
