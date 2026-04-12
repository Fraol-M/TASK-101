import Router from '@koa/router';
import { assignmentsRouter } from './assignments/route.js';
import { workbenchRouter } from './workbench/route.js';
import { scoringRouter } from './scoring/route.js';
import { attachmentsRouter } from './attachments/route.js';

export const reviewsRouter = new Router();

reviewsRouter.use(assignmentsRouter.routes(), assignmentsRouter.allowedMethods());
reviewsRouter.use(workbenchRouter.routes(), workbenchRouter.allowedMethods());
reviewsRouter.use(scoringRouter.routes(), scoringRouter.allowedMethods());
reviewsRouter.use(attachmentsRouter.routes(), attachmentsRouter.allowedMethods());
