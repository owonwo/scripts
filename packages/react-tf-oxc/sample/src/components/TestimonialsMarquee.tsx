type TestimonialsMarqueeProps = {
  direction?: "left" | "right";
  speed?: number;
};

export function TestimonialsMarquee(props: TestimonialsMarqueeProps) {
  const { direction = "left", speed = 30 } = props;

  return (
    <div>
      <p>
        Direction: {direction}, Speed: {speed}
      </p>
    </div>
  );
}
