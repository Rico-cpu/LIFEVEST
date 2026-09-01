/**
 * Loading skeleton — §23.
 *
 * Shaped like the screen it precedes, so nothing jumps when the real content
 * arrives. A spinner would say "something is happening"; this says "this is
 * what is about to be here", which is the more useful message.
 *
 * No percentages: a fake progress bar is a lie told to buy patience.
 */
export default function Skeleton() {
  return (
    <div className="vy-skel" aria-hidden="true">
      <div className="vy-skel-line" style={{ width: '30%', height: 11, marginBottom: 14 }} />
      <div className="vy-skel-line" style={{ width: '62%', height: 20, marginBottom: 40 }} />

      <div className="vy-skel-line" style={{ width: '22%', height: 11, marginBottom: 12 }} />
      <div className="vy-skel-line" style={{ width: '46%', height: 46, marginBottom: 10 }} />
      <div className="vy-skel-line" style={{ width: '34%', height: 12, marginBottom: 40 }} />

      <div className="vy-skel-card" />
      <div className="vy-skel-card" style={{ height: 150 }} />
    </div>
  );
}
