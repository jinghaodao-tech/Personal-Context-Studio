import { dashboardHtml as baseDashboardHtml } from "./dashboard/index.ts";
import { experienceScript } from "./dashboard/experience.ts";
import { experienceReviewScript } from "./dashboard/experienceReview.ts";

export const dashboardHtml = baseDashboardHtml.replace("</body>", `<script>${experienceScript}</script><script>${experienceReviewScript}</script></body>`);
