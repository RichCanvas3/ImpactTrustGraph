"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function FunderOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/onboarding?role=funder");
  }, [router]);

  return null;
}

