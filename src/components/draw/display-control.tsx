"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { channelName, displayMessageSchema } from "@/lib/broadcast";

// E2-01 Feature 3: "Open public display" control + connection indicator,
// mounted in the draw screen's data-slot="display-control" slot. The
// indicator has one-shot semantics (A7): it flips to "Display connected"
// when a {type:'display-ready'} ping arrives and means "a display tab has
// connected at least once this session" — it does not detect later tab
// close. Admin flows never depend on a listener existing (BR5): this
// component is a pure affordance.

export function DisplayControl({ raffleId }: { raffleId: string }) {
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    // No BroadcastChannel support → the indicator simply never shows
    // connected, which is the operator's cue (FSD Feature 1 Error States).
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName(raffleId));
    channel.onmessage = (event) => {
      const parsed = displayMessageSchema.safeParse(event.data);
      if (parsed.success && parsed.data.type === "display-ready") {
        setConnected(true);
      }
    };
    return () => channel.close();
  }, [raffleId]);

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={connected ? "default" : "outline"}
        className="font-normal"
      >
        {connected ? "Display connected" : "No display connected"}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          window.open(`/display/${raffleId}`, "_blank", "noopener,noreferrer")
        }
      >
        Open public display
      </Button>
    </div>
  );
}
