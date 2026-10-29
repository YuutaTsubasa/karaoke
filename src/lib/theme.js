// Lyric themes and fonts for the stage. All fonts are SIL Open Font License (Fontsource).
import '@fontsource/m-plus-rounded-1c/800.css';
import '@fontsource/zen-maru-gothic/900.css';
import '@fontsource-variable/noto-sans-jp/index.css';
import '@fontsource-variable/noto-sans-tc/index.css';

const CJK_FALLBACK = `"Noto Sans TC Variable", "Noto Sans JP Variable", "Microsoft JhengHei UI", "Yu Gothic UI", sans-serif`;

export const FONTS = {
  rounded: { label: 'M PLUS Rounded 1c（圓體）', family: `"M PLUS Rounded 1c", ${CJK_FALLBACK}`, weight: 800 },
  maru: { label: 'Zen Maru Gothic（丸ゴシック）', family: `"Zen Maru Gothic", ${CJK_FALLBACK}`, weight: 900 },
  gothic: { label: 'Noto Sans JP（黑體）', family: `"Noto Sans JP Variable", ${CJK_FALLBACK}`, weight: 900 },
};

export const THEMES = {
  blue: { label: '藍', fill: '#ffffff', stroke: '#0a1440', sungFill: 'linear-gradient(180deg, #9fc2ff 0%, #4a72ff 45%, #183dd6 100%)', sungSolid: '#3a62f0', sungStroke: '#ffffff' },
  pink: { label: '粉', fill: '#ffffff', stroke: '#3a0a2a', sungFill: 'linear-gradient(180deg, #ffd0e6 0%, #ff6fae 50%, #e0267a 100%)', sungSolid: '#f0478f', sungStroke: '#ffffff' },
  yellow: { label: '黃', fill: '#ffffff', stroke: '#0b0f1a', sungFill: 'linear-gradient(180deg, #fff6b0 0%, #ffd21f 50%, #ff9d00 100%)', sungSolid: '#ffc400', sungStroke: '#0b0f1a' },
  classic: { label: '經典（白→藍，黑框）', fill: '#ffffff', stroke: '#000000', sungFill: 'linear-gradient(180deg, #6ad2ff 0%, #1b7cff 55%, #0b46c9 100%)', sungSolid: '#1b7cff', sungStroke: '#ffffff' },
};

/** text-shadow ring that draws a round outline of radius r (em) */
function ring(color, r, steps = 24) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(`${(Math.cos(a) * r).toFixed(3)}em ${(Math.sin(a) * r).toFixed(3)}em 0 ${color}`);
  }
  // fill the inside of thick rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    out.push(`${(Math.cos(a) * r * 0.55).toFixed(3)}em ${(Math.sin(a) * r * 0.55).toFixed(3)}em 0 ${color}`);
  }
  return out.join(', ');
}

/** CSS custom properties for a theme/font/size, to put on the stage's parent. */
export function stageVars({ theme = 'blue', font = 'rounded', size, bottom, outline = 0.085 } = {}) {
  const t = THEMES[theme] || THEMES.blue;
  const f = FONTS[font] || FONTS.rounded;
  const vars = {
    '--k-font': f.family,
    '--k-weight': f.weight,
    '--k-fill': t.fill,
    '--k-stroke': t.stroke,
    '--k-sung-fill': t.sungFill,
    '--k-sung-solid': t.sungSolid,
    '--k-sung-stroke': t.sungStroke,
    '--k-ring-stroke': ring(t.stroke, outline),
    '--k-ring-sung': ring(t.sungStroke, outline),
    '--k-ring-thin': ring(t.stroke, 0.07, 16),
  };
  if (size) vars['--k-size'] = `${size}cqh`;
  if (bottom != null) vars['--k-bottom'] = `${bottom}cqh`;
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}
