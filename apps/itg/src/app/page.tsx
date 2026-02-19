"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Container,
  Link as MUILink,
  List,
  ListItem,
  ListItemText,
  Typography
} from "@mui/material";
import { useConnection } from "../components/connection-context";
import { sepolia } from "viem/chains";

export default function HomePage() {
  const router = useRouter();
  const { user } = useConnection();

  // NOTE: We used to auto-redirect connected users with existing orgs to /dashboard.
  // This caused unexpected navigation away from other routes (e.g. /messages),
  // so the automatic redirect has been disabled. Users can navigate via the header.
  return (
    <main>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Box sx={{ mb: 3 }}>
          <Breadcrumbs aria-label="breadcrumb" sx={{ fontSize: 12 }}>
            <Typography color="text.secondary">Home</Typography>
          </Breadcrumbs>
        </Box>

        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 4,
            alignItems: { xs: "stretch", md: "flex-start" }
          }}
        >
          <Box sx={{ flex: 3, minWidth: 0 }}>
            <Typography
              variant="h3"
              component="h1"
              sx={{ mb: 1.5, fontWeight: 600 }}
            >
              ATN Organization Registry
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ maxWidth: "40rem", mb: 3, lineHeight: 1.7 }}
            >
              Register your organization, create an official ATN Identity, and
              then continue into the application environment where all
              operational work is coordinated.
            </Typography>

            <Card
              variant="outlined"
              sx={{
                maxWidth: 480,
                borderLeftWidth: 5,
                borderLeftColor: "secondary.main"
              }}
            >
              <CardContent>
                <Typography
                  variant="h6"
                  component="h2"
                  sx={{ mb: 1.5, fontWeight: 600 }}
                >
                  Get started
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  Anyone may initiate an ATN Identity registration. This
                  self-service flow does not include a manual review step.
                </Typography>
                <Button
                  component={Link}
                  href="/onboarding"
                  variant="contained"
                  color="primary"
                  sx={{ borderRadius: 999, px: 3 }}
                >
                  Register your organization
                </Button>
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ flex: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{ textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}
              color="text.secondary"
            >
              Process overview
            </Typography>
            <Typography
              variant="h6"
              component="h3"
              sx={{ mb: 1.5, fontWeight: 600 }}
            >
              What happens next
            </Typography>
            <List dense sx={{ pl: 0 }}>
              <ListItem disableGutters>
                <ListItemText primary="Connect with your approved sign-in method using Web3Auth." />
              </ListItem>
              <ListItem disableGutters>
                <ListItemText primary="Provide basic organization details (name, address, organization type)." />
              </ListItem>
              <ListItem disableGutters>
                <ListItemText primary="Confirm authorization to create an ATN Identity on behalf of the organization." />
              </ListItem>
              <ListItem disableGutters>
                <ListItemText primary="Receive your new ATN and proceed into the application environment." />
              </ListItem>
            </List>

            <Typography variant="caption" color="text.secondary">
              For questions about eligibility or documentation, please contact
              your designated ATN program representative or refer to official
              guidance materials.
            </Typography>

            <Box sx={{ mt: 2 }}>
              <MUILink
                component={Link}
                href="/app"
                variant="body2"
                color="primary"
                underline="hover"
              >
                Skip to application environment
              </MUILink>
            </Box>
          </Box>
        </Box>
      </Container>
    </main>
  );
}

