"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useConnection } from "../../components/connection-context";
import { useCurrentUserProfile } from "../../components/useCurrentUserProfile";
import { UserCapabilitiesEditor } from "../../components/UserCapabilitiesEditor";

export default function UserCapabilitiesPage() {
  const { user } = useConnection();
  const { profile, role } = useCurrentUserProfile();
  const individualId = React.useMemo(() => {
    const raw = (profile as any)?.id;
    if (raw == null) return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [profile]);

  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2.5}>
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
                  Capabilities
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Manage your capabilities used for matching, review, and fulfillment.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button component={Link} href="/user-settings" variant="outlined">
                    User Settings
                  </Button>
                  <Button component={Link} href="/app" variant="outlined">
                    Workspace
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {!user ? (
            <Alert severity="warning">
              Not connected. Go to <Link href="/onboarding">onboarding</Link>.
            </Alert>
          ) : (
            <UserCapabilitiesEditor individualId={individualId} role={role} />
          )}
        </Stack>
      </Box>
    </main>
  );
}

