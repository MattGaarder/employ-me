import { Router } from 'express';
import { searchJobs, getJobDetails } from '../controllers/jobs.controller';

const router = Router();

router.get('/search', searchJobs);
router.get('/:id', getJobDetails);

export default router;
