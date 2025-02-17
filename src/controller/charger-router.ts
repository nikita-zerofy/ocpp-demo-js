import express from 'express';
import type {Request, Response} from 'express';
import {ChargerController} from './charger-controller';
import type {ChargerRepository} from '../repository/database';

export function createChargerRouter(chargerRepository: ChargerRepository) {
  const router = express.Router();
  const chargerController = new ChargerController(chargerRepository);

  // Charger CRUD endpoints:
  router.post('/chargers', async (req: Request, res: Response) => {
    await chargerController.createCharger(req, res);
  });

  router.get('/chargers', async (req: Request, res: Response) => {
    await chargerController.getAllChargers(req, res);
  });

  router.get('/chargers/:identity', async (req: Request, res: Response) => {
    await chargerController.getCharger(req, res);
  });

  router.put('/chargers/:identity', async (req: Request, res: Response) => {
    await chargerController.updateCharger(req, res);
  });

  router.delete('/chargers/:identity', async (req: Request, res: Response) => {
    await chargerController.deleteCharger(req, res);
  });

  // Charging control endpoints:
  router.post('/charge/:identity', async (req: Request, res: Response) => {
    await chargerController.startCharging(req, res);
  });

  router.post('/stopCharging/:identity', async (req: Request, res: Response) => {
    await chargerController.stopCharging(req, res);
  });

  router.post('/chargeDefault/:identity', async (req: Request, res: Response) => {
    await chargerController.chargeDefault(req, res);
  });

  router.post('/triggerMessage/:identity', async (req: Request, res: Response) => {
    await chargerController.triggerMessage(req, res);
  });

  router.post('/changeCurrent/:identity', async (req: Request, res: Response) => {
    await chargerController.changeCurrent(req, res);
  });

  router.get('/config/:identity', async (req: Request, res: Response) => {
    await chargerController.getConfiguration(req, res);
  });

  return router;
}
