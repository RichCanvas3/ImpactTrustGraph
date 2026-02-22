"use client";

import * as React from "react";
import Link from "next/link";
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";

export default function UserToolsPage() {
  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
                User Tools
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Tools for your individual profile and agent.
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button component={Link} href="/user-settings" variant="contained">
                  User Settings
                </Button>
                <Button component={Link} href="/app" variant="outlined">
                  Workspace
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </main>
  );
}

