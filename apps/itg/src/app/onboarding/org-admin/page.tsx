"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function OrgAdminOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/onboarding?role=org-admin");
  }, [router]);

  return null;
}

