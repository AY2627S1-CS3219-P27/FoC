import { describe, expect, it } from "vitest";
import {
  buildEditBody,
  editProblem,
  initialEditValues,
  NOTHING_CHANGED,
  savedMessage,
  type EditValues,
} from "./edit-errand";
import type { BuildingOption, Errand } from "./types";

const com2: BuildingOption = { id: "b-com2", shortName: "COM2", canonicalName: "Computing 2" };
const as6: BuildingOption = { id: "b-as6", shortName: "AS6", canonicalName: "Arts 6" };
const pin: BuildingOption = { id: "b-pin", shortName: "PIN", canonicalName: "Other (map pin)", allowsPin: true };

const errand = (over: Partial<Errand> = {}): Errand => ({
  id: "e1",
  status: "Open",
  supplierId: "s1",
  pickupName: "Cool Spot",
  pickupLocation: "COM2",
  pickupDescription: null,
  deliveryLocation: "COM2",
  deliveryDetail: "Level 3",
  collectionItems: "tea",
  description: null,
  rewardCredits: 5,
  expiresAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  ...over,
});

const initial = initialEditValues(errand(), [com2, as6, pin]);
const edit = (over: Partial<EditValues>): EditValues => ({ ...initial, ...over });

describe("initialEditValues", () => {
  it("finds the building by its short name", () => {
    expect(initial.deliveryBuildingId).toBe("b-com2");
  });

  it("leaves the building empty when the short name is not a single match", () => {
    const twin = { ...as6, id: "b-twin", shortName: "COM2" };
    expect(initialEditValues(errand(), [com2, twin]).deliveryBuildingId).toBe("");
    expect(initialEditValues(errand({ deliveryLocation: null }), [com2]).deliveryBuildingId).toBe("");
  });

  it("never picks the map pin placeholder", () => {
    expect(initialEditValues(errand({ deliveryLocation: "PIN" }), [com2, pin]).deliveryBuildingId).toBe("");
  });
});

describe("buildEditBody", () => {
  it("sends nothing when nothing changed, so no re-check or credit call starts", () => {
    expect(buildEditBody(initial, edit({}))).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(buildEditBody(initial, edit({ collectionItems: "two teas", expiryDurationMinutes: 60 }))).toEqual({
      collectionItems: "two teas",
      expiryDurationMinutes: 60,
    });
    expect(buildEditBody(initial, edit({ supplierId: "s2" }))).toEqual({ supplierId: "s2" });
    expect(buildEditBody(initial, edit({ rewardCredits: "9" }))).toEqual({ rewardCredits: 9 });
  });

  it("ignores whitespace-only differences and a cleared picker", () => {
    expect(buildEditBody(initial, edit({ deliveryDetail: " Level 3 ", deliveryBuildingId: "", supplierId: "" }))).toEqual({});
    expect(buildEditBody(initial, edit({ rewardCredits: "05" }))).toEqual({});
  });

  it("lets the note be cleared", () => {
    const withNote = initialEditValues(errand({ description: "ring twice" }), [com2]);
    expect(buildEditBody(withNote, { ...withNote, description: "  " })).toEqual({ description: "" });
  });
});

describe("editProblem", () => {
  it("is NOTHING_CHANGED until something changes", () => {
    expect(editProblem(initial, edit({}))).toBe(NOTHING_CHANGED);
    expect(editProblem(initial, edit({ collectionItems: "coffee" }))).toBeNull();
  });

  it("refuses a reward and a supplier or building change together", () => {
    expect(editProblem(initial, edit({ rewardCredits: "9", supplierId: "s2" }))).toMatch(/separate edits/);
    expect(editProblem(initial, edit({ rewardCredits: "9", deliveryBuildingId: "b-as6" }))).toMatch(/separate edits/);
  });

  it.each(["", "0", "1.5", "-1", "2147483648"])("refuses the reward %j", (rewardCredits) => {
    expect(editProblem(initial, edit({ rewardCredits }))).toMatch(/whole number/);
  });

  it("refuses blank items and blanking the room or level", () => {
    expect(editProblem(initial, edit({ collectionItems: "  " }))).toMatch(/items/);
    expect(editProblem(initial, edit({ deliveryDetail: "  " }))).toMatch(/room or level/);
  });

  describe("an errand whose venue allowed a blank room or level", () => {
    const venue = initialEditValues(errand({ deliveryDetail: "" }), [com2, as6]);

    it("can change other fields while it stays blank", () => {
      expect(editProblem(venue, { ...venue, collectionItems: "coffee" })).toBeNull();
    });

    it("needs one before moving building, since the venue is dropped", () => {
      expect(editProblem(venue, { ...venue, deliveryBuildingId: "b-as6" })).toMatch(/removes the venue/);
      expect(editProblem(venue, { ...venue, deliveryBuildingId: "b-as6", deliveryDetail: "Level 5" })).toBeNull();
    });
  });
});

describe("savedMessage", () => {
  it("does not claim a re-checked or credit change has already applied", () => {
    expect(savedMessage({ supplierId: "s2" }).description).toMatch(/applies once confirmed/);
    expect(savedMessage({ deliveryBuildingId: "b" }).description).toMatch(/applies once confirmed/);
    expect(savedMessage({ rewardCredits: 9 }).title).toBe("Reward change sent");
    expect(savedMessage({ description: "x" })).toEqual({ title: "Errand updated" });
  });
});
