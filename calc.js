#!/usr/bin/node

'use strict';

const fs = require('fs');
const assert = require('assert');
const iconv = new require('iconv').Iconv('windows-1251', 'utf8');

calc(buildTables(getArgs()));

function getDocIndex(table, row) {
	return table.getValue('date_oper', row) + '-' +
		table.getValue('number', row);
}

function calc(tables) {
//	const transitEur = tables.transitEur;
	const transitUsd = tables.transitUsd;
	const main = tables.main;
//	const eur = tables.eur;
	const usd = tables.usd;
	const records = [];

	const courses = {
//		EUR: {},
		USD: {}
	};

	let exchange = {
//		EUR: {},
		USD: {}
	};

	const taxes = [{}, {}, {}, {}];

	function processValAcc(transitTbl, valTbl, valName) {
		console.log('\n>>> Transit ' + valName + ':');

		for (let i = 0; i < transitTbl.data.length; i++) {
			if (transitTbl.getValue('d_c', i) === 'D') {
				continue;
			}

			const date = transitTbl.getValue('date_oper', i);
			const rate = transitTbl.getValue('bal_curr', i);
			const sumVal = transitTbl.getValue('sum_val', i);

			if (sumVal === '0.00') {
				continue;
			}

			const payment = {
				date: date,
				from: transitTbl.getValue('plat_name', i),
				rub: new Number((transitTbl.getValue('sum_val', i) * rate).
					toFixed(2))
			};

			console.log(`Payment: ${payment.date} ${payment.from} ` +
				`${sumVal} / ${payment.rub}`);

			records.push(payment);
			courses[valName][date] = new Number(rate);
		}

		console.log('\n>>> Exchange ' + valName + ':');

		for (let i = 0; i < valTbl.data.length; i++) {
			if (valTbl.getValue('d_c', i) === 'C') {
				continue;
			}

			if (valTbl.getValue('plat_swift', i)) {
				// External payment
				continue;
			}

			if (valTbl.getValue('sum_val', i) === '0.00') {
				continue;
			}

			const val = new Number(valTbl.getValue('sum_val', i));

			const date = valTbl.getValue('date_oper', i);
			const rate = new Number(valTbl.getValue('bal_curr', i));

			const num = getDocIndex(valTbl, i);
			const sum = new Number(val * rate).toFixed(2);


			courses[valName][date] = rate;

			console.log(date, padRight(val.toString(), 10), '*',
				padRight(rate.toString(), 8), '=', sum);

			assert(!(num in exchange[valName]));
			exchange[valName][num] = val;
		}
	}

//	processValAcc(transitEur, eur, 'EUR');
	processValAcc(transitUsd, usd, 'USD');
	console.log('\n>>> Main:');

	for (let i = 0; i < main.data.length; i++) {
		let date = main.getValue('date_oper', i);
		let sum = new Number(main.getValue('sum_val', i));
		let taxPeriod = main.getValue('TaxPeriod', i);

		// Paid taxes
		if (main.getValue('d_c', i) === 'D') {
			if (main.getValue('Pol_inn', i) === '2302067397' &&
					taxPeriod.endsWith(tables.year)) {

				let q = parseInt(taxPeriod.substr(3, 2)) - 1;

				if (taxPeriod.startsWith('ПЛ')) {
					if (q == 0) {
						q = 1;
					}
					if (q == 1) {
						q = 3;
					}

				}

				let text = main.getValue('text70', i);
				let type;

				if (text.indexOf('ФФОМС') >= 0) {
					type = 'FFOMS';
				} else if (text.indexOf('033-059-007183') >= 0) {
					if (text.indexOf('1%') >= 0) {
						type = 'PFR1';
					} else {
						type = 'PFR';
					}
				} else if (text.indexOf('налогообложения') >=0 ) {
					type = 'TAX6';
				}

				if (!type) {
					console.log('!!! Unknown tax payment:', text);
					continue;
				}

				taxes[q] = taxes[q] || {};
				taxes[q][type] = (taxes[q][type] || 0) + new Number(sum);
			}

			continue;
		}

		let from = main.getValue('plat_name', i);

		if (from.startsWith('Комаров Алексей Аркадьевич')) {
			continue;
		}

		if (from.startsWith('ИП Комаров Алексей Аркадьевич')) {
			continue;
		}

		if (from.startsWith('IP KOMAROV ALEKSEI ARKADEVICH')) {
			let valCode = main.getValue('plat_acc', i).substr(5, 3);

			let valName = {
//				978: 'EUR',
				840: 'USD'
			}[valCode];

			assert(valName, 'Unknown currency: ' + valCode);
			from = 'Convertation ' + valName;

			let rate = courses[valName][date];

			if (!rate) {
				abort(`No courses for ${valName} on ${date}`);
			}

			let corrSum = exchange[valName][getDocIndex(main, i)];

			if (!corrSum) {
				abort('No correspondent document found for exchange operation');
			}

			let cbSum = rate * corrSum;

			if (cbSum < sum) {
				sum = new Number((sum - cbSum).toFixed(2));
			} else {
				continue;
			}
		}

		console.log(date, padRight(sum.toString(), 12), from);

		records.push({
			date: date,
			from: from,
			rub: sum
		});
	}

	console.log('\nTotal:');

	records.sort((a, b) => {
		a = a.date.substr(6,4) + a.date.substr(3, 2) + a.date.substr(0, 2);
		b = b.date.substr(6,4) + b.date.substr(3, 2) + b.date.substr(0, 2);

		if (a < b) {
			return -1;
		} else if (a > b) {
			return 1;
		}

		return 0;
	});

	let sum = 0;

	let curQuarter = -1;
	let qTotal = 0;

	records.forEach(x => {
		let q = getQuarter(x.date);

		if (curQuarter !== q) {
			if (curQuarter !== -1) {
				console.log('TOTAL', qTotal);
				qTotal = 0;
			}

			console.log('\nQUARTER', q + 1);
			curQuarter = q;
		}

		console.log(x.date, padRight(x.rub.toString(), 12), x.from);
		qTotal += x.rub;
		sum += x.rub;
	});

	console.log('TOTAL', qTotal, '\n');

	let taxes6 = Math.round(sum * 0.06);

	console.log('\n>>> TOTAL:   ', sum.toFixed(2));
	console.log('>>> TAXES 6%:', taxes6);

	let pfr = 0;

	if (sum > 300000) {
		pfr = Number(((sum - 300000) * 0.01).toFixed(2));
	}

	console.log('>>> PFR 1%:  ', pfr);
	let quarters = [0, 0, 0, 0];

	records.forEach(x => {
		quarters[getQuarter(x.date)] += x.rub;
	});

	console.log('\n');
	pfr = 0;
	taxes6 = 0;
	sum = 0;
	let paidTotal = 0;
	let paidPfr = 0;
	let paid = 0;

	[0, 1, 2, 3].forEach(q => {
		if (quarters[q] == 0) {
			return;
		}

		quarters[q] = Number(quarters[q].toFixed(2));
		sum += quarters[q];

		sum = Number(sum.toFixed(2));

		if (sum > 300000) {
			pfr = Number(((sum - 300000) * 0.01).toFixed(2));
		}

		let pfrToPay = Number(pfr).toFixed(2) - paidPfr;
		taxes6 = Math.round(sum * 0.06);

		console.log('Quarter:', q + 1);
		console.log('Total:', 'Quarter =', quarters[q], 'Total =', sum);
		console.log('6%:', Math.round(quarters[q] * 0.06));
		console.log('PFR 1%:', Number(pfrToPay).toFixed(2));

		console.log('Taxes:', 'Pay =', Math.round(taxes6 - paid),
			'Total =', Math.round(taxes6));

		console.log('\nPaid:');

		if (taxes[q]) {
			if (taxes[q].PFR1) {
				if (taxes[q].PFR1 == pfrToPay) {
					console.log('PFR 1% OK:', taxes[q].PFR1.toString());
				} else {
					console.log('PFR 1% NOT OK:', taxes[q].PFR1.toString());
				}

				paid += taxes[q].PFR1;
				paidPfr += taxes[q].PFR1;
			} else {
				console.log('PFR 1%: NOT PAID');
			}

			if (taxes[q].PFR) {
				console.log('PFR:', taxes[q].PFR.toString());
				paid += taxes[q].PFR;

			} else {
				console.log('PFR: NOT PAID');
			}

			if (taxes[q].FFOMS) {
				console.log('FFOMS:', taxes[q].FFOMS.toString());
				paid += taxes[q].FFOMS;
			} else {
				console.log('FFOMS: NOT PAID');
			}

			let toPay = Math.round(taxes6 - paid);

			if (taxes[q].TAX6) {
				if (toPay == taxes[q].TAX6) {
					console.log('6% OK:', taxes[q].TAX6.toString());
				} else {
					console.log('6% NOT OK:', taxes[q].TAX6.toString(), toPay);
				}

				paid = Number((paid + taxes[q].TAX6).toFixed(2));
			} else {
				console.log('6% NOT PAID, PAY', toPay);
			}
		}

		console.log('\n');
	});
}

function buildTables(args) {
	return {
		year: args.year,
//		transitEur: parseCsv('transitEur', args.transitEurAccFile),
		transitUsd: parseCsv('transitUsd', args.transitUsdAccFile),
		main: parseCsv('main', args.mainAccFile),
//		eur: parseCsv('eur', args.eurAccFile),
		usd: parseCsv('usd', args.usdAccFile)
	};
}

function parseCsv(table, data) {
	const lines = data.split(/\n/);

	return {
		fields: lines.shift().split(/\t+/),
		columns: lines.shift().split(/\t+/),
		data: lines.map(line => line.split(/\t/)),
		getValue: function(field, row) {
			let idx = this.fields.indexOf(field);
			assert(idx > -1, 'No field "' + field + '" in table " ' +
				table + '" ');

			return this.data[row][idx];
		}
	};
}

function help(err) {
	console.error(err);
	console.error(process.argv[1].split('/').pop() + ' year');
	process.exit(1);
}

function abort(err) {
	console.error(err);
	process.exit(2);
}

function getIntArg(idx, name, regExp) {
	const val = process.argv[idx];

	if (val && val.match(regExp)) {
		return parseInt(val);
	}

	help('Invalid ' + name + ': "' + (val || '') + '"');
}

function getArgs() {
	return readData({
		year: getIntArg(2, 'year', new RegExp(/^\d+$/))
	});
}

function checkPath(path) {
	if (!fs.existsSync(path)) {
		abort('No directory: ' + path);
	}

	if (!fs.statSync(path).isDirectory()) {
		abort('Not a directory: ' + path);
	}

	return path;
}

function readFile(path) {
	if (!fs.existsSync(path)) {
		abort('No file: ' + path);
	}

	if (!fs.statSync(path).isFile()) {
		abort('Not a file: ' + path);
	}

	return iconv.convert(fs.readFileSync(path)).toString();
}

function readData(args) {
	let path = checkPath('data/' + args.year.toString());
//	args.transitEurAccFile = readFile(path + '/transitEur.csv');
	args.transitUsdAccFile = readFile(path + '/transitUsd.csv');
	args.mainAccFile = readFile(path + '/main.csv');
//	args.eurAccFile = readFile(path + '/eur.csv');
	args.usdAccFile = readFile(path + '/usd.csv');
	return args;
}

function padRight(str, len) {
	while (str.length < len) {
		str = str + ' ';
	}

	return str;
}

function getQuarter(strDate) {
	let month = parseInt(strDate.substr(3, 2));

	if (month < 4) {
		return 0;
	}

	if (month < 7) {
		return 1;
	}

	if (month < 10) {
		return 2;
	}

	return 3;
}
