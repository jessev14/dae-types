const moduleID = 'dae-types';

const lg = (x, highlight) => {
	if (highlight) console.warn('------------------ LG ------------------');
	console.log(x);
};

const typeOptionsMap = {
	0: 'Untyped',
	1: 'Circumstance Bonus',
	2: 'Circumstance Penalty',
	3: 'Item Bonus',
	4: 'Item Penalty',
	5: 'Status Bonus',
	6: 'Status Penalty',
};


Hooks.once('init', () => {
	 libWrapper.register(moduleID, 'CONFIG.Actor.documentClass.prototype.prepareData', newPrepareEmbeddedDocuments, 'WRAPPER');
	 libWrapper.register(moduleID, 'CONFIG.ActiveEffect.documentClass.prototype.apply', newApply, 'MIXED');
});

Hooks.once('ready', () => {
	libWrapper.register(moduleID, 'DAE.DAEActiveEffectConfig.prototype._onEffectControl', new_onEffectControl, 'MIXED');
});


Hooks.on('renderDAEActiveEffectConfig', (app, [html], appData) => {
	const activeEffect = app.object;

	const og_getSubmitData = app._getSubmitData;
	app._getSubmitData = function (...args) {
		const data = og_getSubmitData.call(app, ...args);

		const flagDataArray = [];
		for (const flagData of Object.values(data[moduleID] || {})) {
			flagDataArray.push({
				type: flagData.type
			});
		}
		data.flags[moduleID] = {
			data: flagDataArray
		};

		return data;
	}

	const header = html.querySelector('header.effects-header');

	const keyHeader = header.querySelector('div.key');
	keyHeader.style['padding-right'] = '140px';

	const typeHeader = document.createElement('div');
	typeHeader.classList.add('mode');
	typeHeader.style['padding-left'] = '2px';
	typeHeader.innerText = 'Type';
	const modeHeader = header.querySelector('div.mode');
	modeHeader.after(typeHeader);

	const changesListOl = html.querySelector('ol.changes-list');
	const flagDataArray = activeEffect.getFlag(moduleID, 'data');
	for (const [i, changeLi] of changesListOl.querySelectorAll('li.effect-change').entries()) {
		const typeDiv = document.createElement('div');
		typeDiv.classList.add(moduleID, 'type');

		let options = ``;
		const flagData = flagDataArray[i]?.type;
		for (const [j, option] of Object.entries(typeOptionsMap)) {
			options += `<option value="${j}" ${flagData == j ? 'selected' : ''}>${option}</option>`;
		}
		typeDiv.innerHTML = `
            <select name="${moduleID}.${i}.type" data-dtype="Number" style="width:130px">
                ${options}
            </select>
        `;

		const modeDiv = changeLi.querySelector('div.mode');
		modeDiv.after(typeDiv);
	}
});


function new_onEffectControl(wrapped, event) {
	event.preventDefault();

	const action = event.currentTarget.dataset.action;
	if (action !== 'delete') return wrapped(event);

	const confirmDelete = game.settings.get('dae', 'confirmDelete');
	return DAE.confirmAction(confirmDelete, async () => {
		const button = event.currentTarget;
		const changeIdx = button.closest('li.effect-change').dataset.index;

		const flagDataArray = this.object.getFlag(moduleID, 'data');
		flagDataArray.splice(changeIdx, 1);
		await this.object.setFlag(moduleID, 'data', flagDataArray);

		button.closest('.effect-change').remove();
		return this.submit({ preventClose: true }).then(() => this.render());
	});
}

function newPrepareEmbeddedDocuments(wrapped) {
	wrapped();

	// Process each AE on the actor.
	for (const ae of this.effects) {
		const { changes } = ae;
		const newChanges = [];

		// Inject the dae-type from the flag data array into each change themselves.
		const flagDataArray = ae.getFlag(moduleID, 'data');
		changes.forEach((c, i) => {
			c[moduleID] = flagDataArray?.[i]?.type;
		});

		// Group the changes by key.
		const changesByKey = {};
		for (const change of changes) {
			if (!changesByKey[change.key]) changesByKey[change.key] = [change];
			else changesByKey[change.key].push(change);
		}

		// For each key-group:
		for (const [key, changesArr] of Object.entries(changesByKey)) {
			const keyValue = foundry.utils.getProperty(this, key);

			// For each dae-type:
			for (const daeType of Object.keys(typeOptionsMap)) {
				const isPenalty = Number(daeType) % 2 === 0;

				// Collect changes within current key group that are of the current dae-type.
				const changesOfCurrentType = changesArr.filter(c => c[moduleID] == daeType);
				if (daeType == 0) continue;

				if (changesOfCurrentType.length < 2) {
					if (changesOfCurrentType[0]) newChanges.push(changesOfCurrentType[0]);
					continue;
				}

				if (!keyValue || !Number(keyValue)) continue;

				// Loop through each change of current dae-type and determine best value.
				let bestValue = keyValue;
				let bestChange;
				for (const change of changesOfCurrentType) {
					change.skip = false;
					ae.apply(this, change);
					change.skip = true;
					const afterValue = foundry.utils.getProperty(this, key);

					if (isPenalty) {
						if (afterValue < bestValue) {
							bestValue = afterValue;
							bestChange = change;
						}
					} else {
						if (afterValue > bestValue) {
							bestValue = afterValue;
							bestChange = change;
						}
					}

					foundry.utils.setProperty(this, key, keyValue);
				}
				if (bestChange) newChanges.push(bestChange);
			}
		}

		// Once target changes are found, flag to not skip them during apply.
		newChanges.forEach(c => c.skip = false);
	}
}

function newApply(wrapped, actor, change) {
	if (change.skip && !change['dae-types']) return;

	return wrapped(actor, change);
}
