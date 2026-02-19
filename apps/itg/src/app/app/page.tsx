import { Box, Container, Typography } from "@mui/material";

export default function ApplicationEnvironmentPage() {
  return (
    <main>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Typography
          variant="h4"
          component="h1"
          sx={{ mb: 1.5, fontWeight: 600 }}
        >
        ATN Application Environment
        </Typography>
        <Typography
          variant="body1"
          sx={{ maxWidth: "42rem", lineHeight: 1.7, mb: 3 }}
        >
        This is the placeholder application environment where all ongoing work
        related to ATN identities, operations, and coordination will take
          place. Dashboards, workflows, and collaboration tools can be
          introduced here as the program evolves.
        </Typography>
        <Box
          sx={{
            borderRadius: 2,
            border: "1px dashed",
            borderColor: "divider",
            p: 2,
            maxWidth: "42rem"
          }}
        >
          <Typography variant="subtitle2" color="text.secondary">
            Implementation note
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Use this space to integrate operational modules, reporting views,
            and coordination tools consistent with official ATN guidance.
          </Typography>
        </Box>
      </Container>
    </main>
  );
}


