type TestimonialsMarqueeProps = {
  direction?: "left" | "right";
  speed?: number;
};

export function TestimonialsMarquee({ direction = "left", speed = 30 }: TestimonialsMarqueeProps) {

  return (
    <div>
      <p>
        Direction: {direction}, Speed: {speed}
      </p>
    </div>
  );
}
