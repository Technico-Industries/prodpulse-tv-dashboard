import styles from './Panel.module.css';

// Card shell shared by every dashboard panel. `demo` adds the DEMO tag that
// marks values coming from demonstration data.
export default function Panel({ title, subtitle, icon: Icon, right, demo = false, className = '', bodyClassName = '', children }) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>
            {Icon && <Icon className={styles.icon} aria-hidden />}
            {title}
            {demo && <DemoTag />}
          </h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {right && <div className={styles.right}>{right}</div>}
      </header>
      <div className={`${styles.body} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function DemoTag() {
  return <span className={styles.demoTag} title="Demonstration data — not real production values">Demo</span>;
}

// Legend entry — series identity is never colour alone, it always has a label.
export function LegendItem({ color, label, dashed = false }) {
  return (
    <span className={styles.legendItem}>
      <span
        className={dashed ? styles.legendDash : styles.legendSwatch}
        style={dashed ? { borderColor: color } : { background: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}
